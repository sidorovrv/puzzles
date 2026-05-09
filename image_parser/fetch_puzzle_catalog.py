#!/usr/bin/env python3

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT_DIR / 'docs' / 'data' / 'puzzles.json'
DEFAULT_LIMIT_PER_CATEGORY = 150
USER_AGENT = 'PuzzlesCatalogBuilder/1.0 (metadata only; no image downloads)'
MAX_DESCRIPTION_LENGTH = 300
REQUEST_HEADERS = {
    'Accept': 'application/json',
    'User-Agent': USER_AGENT,
}
SOURCE_CONFIGS = [
    {
        'category': 'animals',
        'url': 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=incategory:%22Featured+pictures+on+Wikimedia+Commons%22+animal&gsrnamespace=6&gsrlimit=50&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&format=json',
    },
    {
        'category': 'architecture',
        'url': 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=incategory:%22Featured+pictures+on+Wikimedia+Commons%22+architecture&gsrnamespace=6&gsrlimit=50&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&format=json',
    },
    {
        'category': 'carnivora',
        'url': 'https://commons.wikimedia.org/w/api.php?action=query&generator=images&titles=Commons:Featured_pictures/Animals/Mammals/Carnivora&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&gimlimit=50&format=json',
    },
    {
        'category': 'mammals',
        'url': 'https://commons.wikimedia.org/w/api.php?action=query&generator=images&titles=Commons:Featured_pictures/Animals/Mammals&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&gimlimit=50&format=json',
    },
    {
        'category': 'plants',
        'url': 'https://commons.wikimedia.org/w/api.php?action=query&generator=images&titles=Commons:Featured_pictures/Plants&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&gimlimit=50&format=json',
    },
    {
        'category': 'architecture_exteriors',
        'url': 'https://commons.wikimedia.org/w/api.php?action=query&generator=images&titles=Commons:Featured_pictures/Places/Architecture/Exteriors&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&gimlimit=50&format=json',
    },
]
TAG_RE = re.compile(r'<[^>]+>')
COMMENT_RE = re.compile(r'<!--.*?-->', re.DOTALL)
INTERNAL_LINK_RE = re.compile(r'\[\[(?:[^|\]]*\|)?([^\]]+)\]\]')
EXTERNAL_LINK_RE = re.compile(r'\[(?:https?://[^\s\]]+)\s+([^\]]+)\]')
ITALIC_MARKUP_RE = re.compile(r"'{2,}")
WHITESPACE_RE = re.compile(r'\s+')


def parse_retry_after_seconds(header_value: str | None) -> float | None:
    if not header_value:
        return None

    try:
        seconds = float(header_value)
    except ValueError:
        return None

    return seconds if seconds >= 0 else None


def fetch_json(url: str, retries: int = 4, pause_seconds: float = 0.0):
    last_error = None
    for attempt in range(retries + 1):
        request = urllib.request.Request(url, headers=REQUEST_HEADERS)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                charset = response.headers.get_content_charset('utf-8')
                payload = response.read().decode(charset)
                if pause_seconds > 0:
                    time.sleep(pause_seconds)
                return json.loads(payload)
        except urllib.error.HTTPError as exc:  # pragma: no cover - runtime network handling
            last_error = exc
            if attempt == retries:
                break

            retry_after = parse_retry_after_seconds(exc.headers.get('Retry-After'))
            if exc.code == 429:
                time.sleep(retry_after if retry_after is not None else 5.0 * (attempt + 1))
                continue

            time.sleep(1.5 * (attempt + 1))
        except Exception as exc:  # pragma: no cover - runtime network handling
            last_error = exc
            if attempt == retries:
                break
            time.sleep(1.5 * (attempt + 1))

    raise RuntimeError(f'Failed to fetch JSON: {url}') from last_error


def apply_continuation(url: str, continuation: dict | None) -> str:
    if not continuation:
        return url

    parsed = urllib.parse.urlsplit(url)
    query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
    query.update({key: str(value) for key, value in continuation.items()})
    return urllib.parse.urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            urllib.parse.urlencode(query),
            parsed.fragment,
        )
    )


def normalize_text(value: str) -> str:
    if not value:
        return ''

    text = TAG_RE.sub(' ', value)
    text = html.unescape(text)
    text = text.replace('\xa0', ' ')
    return WHITESPACE_RE.sub(' ', text).strip()


def extract_balanced_template(text: str, start: int) -> tuple[str, int]:
    if not text.startswith('{{', start):
        return '', start

    depth = 0
    index = start
    while index < len(text) - 1:
        if text.startswith('{{', index):
            depth += 1
            index += 2
            continue
        if text.startswith('}}', index):
            depth -= 1
            index += 2
            if depth == 0:
                return text[start:index], index
            continue
        index += 1

    return '', start


def extract_template_block(text: str, template_name: str) -> str:
    match = re.search(r'\{\{\s*' + re.escape(template_name) + r'\b', text, flags=re.IGNORECASE)
    if not match:
        return ''

    block, _ = extract_balanced_template(text, match.start())
    return block


def iter_template_blocks(text: str):
    index = 0
    while index < len(text):
        start = text.find('{{', index)
        if start < 0:
            return

        block, end_index = extract_balanced_template(text, start)
        if not block:
            index = start + 2
            continue

        yield block
        index = end_index


def split_top_level(text: str, delimiter: str) -> list[str]:
    parts = []
    chunk = []
    template_depth = 0
    link_depth = 0
    index = 0

    while index < len(text):
        if text.startswith('{{', index):
            template_depth += 1
            chunk.append('{{')
            index += 2
            continue
        if text.startswith('}}', index):
            template_depth = max(0, template_depth - 1)
            chunk.append('}}')
            index += 2
            continue
        if text.startswith('[[', index):
            link_depth += 1
            chunk.append('[[')
            index += 2
            continue
        if text.startswith(']]', index):
            link_depth = max(0, link_depth - 1)
            chunk.append(']]')
            index += 2
            continue
        if text[index] == delimiter and template_depth == 0 and link_depth == 0:
            parts.append(''.join(chunk))
            chunk = []
            index += 1
            continue

        chunk.append(text[index])
        index += 1

    parts.append(''.join(chunk))
    return parts


def split_top_level_assignment(text: str) -> tuple[str | None, str]:
    template_depth = 0
    link_depth = 0
    index = 0

    while index < len(text):
        if text.startswith('{{', index):
            template_depth += 1
            index += 2
            continue
        if text.startswith('}}', index):
            template_depth = max(0, template_depth - 1)
            index += 2
            continue
        if text.startswith('[[', index):
            link_depth += 1
            index += 2
            continue
        if text.startswith(']]', index):
            link_depth = max(0, link_depth - 1)
            index += 2
            continue
        if text[index] == '=' and template_depth == 0 and link_depth == 0:
            return text[:index], text[index + 1:]
        index += 1

    return None, text


def parse_template(block: str) -> tuple[str, list[str], dict[str, str]]:
    inner = block[2:-2].strip()
    parts = split_top_level(inner, '|')
    name = parts[0].strip().lower() if parts else ''
    positional = []
    named = {}

    for param in parts[1:]:
        key, value = split_top_level_assignment(param)
        if key is None:
            positional.append(value.strip())
            continue

        key_name = key.strip().lower()
        value = value.strip()
        named[key_name] = value
        if key_name.isdigit():
            while len(positional) < int(key_name):
                positional.append('')
            positional[int(key_name) - 1] = value

    return name, positional, named


def replace_template_blocks(text: str) -> str:
    parts = []
    index = 0

    while index < len(text):
        if text.startswith('{{', index):
            block, end_index = extract_balanced_template(text, index)
            if block:
                parts.append(template_to_text(block))
                index = end_index
                continue

        parts.append(text[index])
        index += 1

    return ''.join(parts)


def template_to_text(block: str) -> str:
    name, positional, named = parse_template(block)
    lowered = name.lower()

    if lowered == 'lang' and len(positional) >= 2:
        return clean_wikitext_text(positional[1])
    if lowered.startswith('lang-') and positional:
        return clean_wikitext_text(positional[0])
    if lowered == 'convert' and positional:
        return clean_wikitext_text(' '.join(part for part in positional[:2] if part))
    if lowered == 'description':
        if 'en' in named:
            return clean_wikitext_text(named['en'])
        if len(positional) >= 2 and positional[0].strip().lower() == 'en':
            return clean_wikitext_text(positional[1])

    if positional:
        return clean_wikitext_text(' '.join(part for part in positional if part))
    if named:
        return clean_wikitext_text(' '.join(value for value in named.values() if value))
    return ''


def clean_wikitext_text(text: str) -> str:
    if not text:
        return ''

    cleaned = COMMENT_RE.sub(' ', text)
    cleaned = replace_template_blocks(cleaned)

    previous = None
    while cleaned != previous:
        previous = cleaned
        cleaned = INTERNAL_LINK_RE.sub(r'\1', cleaned)

    cleaned = EXTERNAL_LINK_RE.sub(r'\1', cleaned)
    cleaned = cleaned.replace('{{!}}', '|')
    cleaned = ITALIC_MARKUP_RE.sub('', cleaned)
    cleaned = cleaned.replace('[[', ' ').replace(']]', ' ')
    cleaned = cleaned.replace('[', ' ').replace(']', ' ')
    return normalize_text(cleaned)


def fetch_file_wikitext(page_title: str, request_pause_seconds: float) -> str:
    url = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(
        {
            'action': 'parse',
            'page': page_title,
            'prop': 'wikitext',
            'format': 'json',
        }
    )
    payload = fetch_json(url, pause_seconds=request_pause_seconds)
    return (payload.get('parse', {}).get('wikitext', {}) or {}).get('*', '')


def extract_description_field(wikitext: str) -> str:
    for block in iter_template_blocks(wikitext):
        _, _, named = parse_template(block)
        description = named.get('description', '')
        if description:
            return description

    return ''


def extract_source_description(wikitext: str) -> str:
    description_field = extract_description_field(wikitext)
    if not description_field:
        return ''

    description_template = extract_template_block(description_field, 'description')
    if description_template:
        _, positional, named = parse_template(description_template)
        if 'en' in named:
            return clean_wikitext_text(named['en'])
        if len(positional) >= 2 and positional[0].strip().lower() == 'en':
            return clean_wikitext_text(positional[1])

    english_template = extract_template_block(description_field, 'en')
    if english_template:
        _, positional, named = parse_template(english_template)
        if positional and positional[0]:
            return clean_wikitext_text(positional[0])
        if '1' in named:
            return clean_wikitext_text(named['1'])

    return clean_wikitext_text(description_field)


def extract_source_description_from_page(
    page: dict,
    image_info: dict,
    request_pause_seconds: float,
) -> str:
    extmetadata = image_info.get('extmetadata') or {}
    image_description = normalize_text((extmetadata.get('ImageDescription') or {}).get('value', ''))
    if image_description:
        return image_description

    object_name = normalize_text((extmetadata.get('ObjectName') or {}).get('value', ''))
    if object_name:
        return object_name

    page_title = page.get('title', '')
    return extract_source_description(fetch_file_wikitext(page_title, request_pause_seconds))


def translate_to_russian(text: str, pause_seconds: float) -> str:
    if not text:
        return ''

    query = urllib.parse.urlencode(
        {
            'client': 'gtx',
            'sl': 'auto',
            'tl': 'ru',
            'dt': 't',
            'q': text,
        }
    )
    url = f'https://translate.googleapis.com/translate_a/single?{query}'
    payload = fetch_json(url)

    try:
        translated = payload[0][0][0]
    except (IndexError, TypeError) as exc:
        raise RuntimeError(f'Unexpected translation payload for text: {text[:80]}') from exc

    if pause_seconds > 0:
        time.sleep(pause_seconds)

    return normalize_text(translated)


def source_page_url(title: str) -> str:
    safe_title = title.replace(' ', '_')
    return f'https://commons.wikimedia.org/wiki/{urllib.parse.quote(safe_title)}'


def clamp_description(text: str, max_length: int = MAX_DESCRIPTION_LENGTH) -> str:
    normalized = normalize_text(text)
    if len(normalized) <= max_length:
        return normalized

    boundary = normalized.rfind(' ', 0, max_length)
    safe_boundary = int(max_length * 0.6)
    end_index = boundary if boundary >= safe_boundary else max_length
    return normalized[:end_index].rstrip()


def build_title(description_ru: str, fallback: str) -> str:
    candidate = description_ru or fallback or 'Puzzle image'
    first_sentence = re.split(r'(?<=[.!?])\s+', candidate, maxsplit=1)[0].rstrip(' .')

    if len(first_sentence) <= 80:
        return first_sentence

    shortened = first_sentence[:77].rsplit(' ', 1)[0].strip()
    return (shortened or first_sentence[:77]).rstrip(' .,') + '...'


def build_entry(category: str, page: dict, pause_seconds: float, request_pause_seconds: float) -> dict | None:
    image_infos = page.get('imageinfo') or []
    if not image_infos:
        print(f'Skipping {page.get("title", "<unknown>")} because imageinfo is missing.', file=sys.stderr)
        return None

    image_info = image_infos[0]
    page_title = page.get('title', '')
    source_description = extract_source_description_from_page(page, image_info, request_pause_seconds)
    if not source_description:
        print(f'Skipping {page.get("title", "<unknown>")} because the wikitext description is empty.', file=sys.stderr)
        return None

    image_url = image_info.get('url')
    thumb_url = image_info.get('thumburl')
    if not image_url or not thumb_url:
        print(f'Skipping {page.get("title", "<unknown>")} because URL data is incomplete.', file=sys.stderr)
        return None

    try:
        description_ru = translate_to_russian(source_description, pause_seconds)
    except Exception as exc:  # pragma: no cover - runtime network handling
        print(f'Warning: translation failed for {page.get("title", "<unknown>")}: {exc}', file=sys.stderr)
        description_ru = source_description

    description_ru = clamp_description(description_ru)

    fallback_title = normalize_text(page.get('title', '')).removeprefix('File:')
    page_id = page.get('pageid')
    if not isinstance(page_id, int):
        print(f'Skipping {page.get("title", "<unknown>")} because pageid is missing.', file=sys.stderr)
        return None

    return {
        'id': f'{category}_{page_id}',
        'sourcePageId': page_id,
        'title': build_title(description_ru, fallback_title),
        'category': category,
        'imageUrl': image_url,
        'thumbUrl': thumb_url,
        'description': description_ru,
        'sourceDescription': source_description,
        'sourcePageUrl': source_page_url(page_title),
    }


def fetch_category_entries(
    category: str,
    url: str,
    limit: int | None,
    pause_seconds: float,
    request_pause_seconds: float,
) -> list[dict]:
    entries = []
    seen_urls = set()
    continuation = None
    batch_index = 0
    scanned_pages = 0
    target_label = str(limit) if limit is not None else '?'

    while limit is None or len(entries) < limit:
        payload = fetch_json(apply_continuation(url, continuation), pause_seconds=request_pause_seconds)
        batch_index += 1
        pages = payload.get('query', {}).get('pages', {})
        sorted_pages = sorted(
            pages.values(),
            key=lambda page: (str(page.get('title', '')).lower(), page.get('pageid', 0)),
        )
        scanned_pages += len(sorted_pages)
        print(
            f'[{category}] batch {batch_index}: fetched {len(sorted_pages)} candidates, '
            f'scanned {scanned_pages}, collected {len(entries)}/{target_label}',
            flush=True,
        )

        if not sorted_pages:
            break

        for page in sorted_pages:
            if limit is not None and len(entries) >= limit:
                break

            entry = build_entry(category, page, pause_seconds, request_pause_seconds)
            if not entry:
                continue
            if entry['imageUrl'] in seen_urls:
                continue
            seen_urls.add(entry['imageUrl'])
            entries.append(entry)
            print(f'[{category}] collected {len(entries)}/{target_label}', flush=True)

        continuation = payload.get('continue')
        if not continuation:
            break

    return entries


def write_catalog(entries: list[dict], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Build the puzzle catalogue from Wikimedia Commons metadata without downloading images.'
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=DEFAULT_OUTPUT,
        help='Path to the generated puzzles.json file.',
    )
    parser.add_argument(
        '--limit-per-category',
        type=int,
        default=DEFAULT_LIMIT_PER_CATEGORY,
        help='Cap for entries fetched from each category.',
    )
    parser.add_argument(
        '--pause-seconds',
        type=float,
        default=0.15,
        help='Pause after each translation request to reduce request bursts.',
    )
    parser.add_argument(
        '--request-pause-seconds',
        type=float,
        default=1.0,
        help='Pause after each Wikimedia API request to reduce rate limiting.',
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    all_entries = []

    for source in SOURCE_CONFIGS:
        entries = fetch_category_entries(
            source['category'],
            source['url'],
            args.limit_per_category,
            args.pause_seconds,
            args.request_pause_seconds,
        )
        print(f"{source['category']}: collected {len(entries)} entries")
        all_entries.extend(entries)

    write_catalog(all_entries, args.output.resolve())
    print(f'Wrote {len(all_entries)} entries to {args.output.resolve()}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())