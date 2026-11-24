"""Zero-dependency S3-compatible object storage client (AWS SigV4) for 融侨学迹.

Supports Bitiful (缤纷云 S4: https://s3.bitiful.net, cn-east-1) and any standard
S3-compatible provider (Cloudflare R2, Aliyun OSS, Tencent COS, MinIO, AWS S3).
Uses only Python standard library modules so standalone desktop builds stay self-contained.
"""
from __future__ import annotations

from datetime import datetime, timezone
import gzip
import hashlib
import hmac
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


BITIFUL_PRESET = {
    'provider': 'bitiful',
    'endpoint': 'https://s3.bitiful.net',
    'region': 'cn-east-1',
    'path_style': True,
    'prefix': 'rongqiao-xueji/',
}

DEFAULT_TIMEOUT = 25
MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _hmac_sha256(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode('utf-8'), hashlib.sha256).digest()


def _signing_key(secret_key: str, date_stamp: str, region: str, service: str = 's3') -> bytes:
    k_date = _hmac_sha256(('AWS4' + secret_key).encode('utf-8'), date_stamp)
    k_region = _hmac_sha256(k_date, region)
    k_service = _hmac_sha256(k_region, service)
    return _hmac_sha256(k_service, 'aws4_request')


def _uri_encode_path(path: str) -> str:
    # SigV4 requires RFC 3986 unreserved characters only; keep '/' intact.
    return '/'.join(quote(seg, safe='-_.~') for seg in path.split('/'))


def _canonical_query(params: dict[str, str] | None) -> str:
    if not params:
        return ''
    items = sorted(
        (quote(str(k), safe='-_.~'), quote(str(v), safe='-_.~'))
        for k, v in params.items()
    )
    return '&'.join(f'{k}={v}' for k, v in items)


def normalize_prefix(raw: str | None) -> str:
    text = str(raw or '').strip().lstrip('/')
    text = re.sub(r'/+', '/', text)
    if not text:
        return 'rongqiao-xueji/'
    if not text.endswith('/'):
        text += '/'
    if '..' in text.split('/'):
        raise ValueError('存储目录前缀不能包含 “..”。')
    return text


def validate_config(raw: dict | None, *, require_credentials: bool = True) -> dict:
    if not isinstance(raw, dict):
        raise ValueError('S3 配置格式无效。')
    provider = str(raw.get('provider') or 'bitiful').strip()[:40]
    endpoint = str(raw.get('endpoint') or '').strip().rstrip('/')
    region = str(raw.get('region') or 'cn-east-1').strip()[:64]
    bucket = str(raw.get('bucket') or '').strip()[:128]
    access_key = str(raw.get('access_key') or '').strip()[:256]
    secret_key = str(raw.get('secret_key') or '').strip()[:256]
    prefix = normalize_prefix(raw.get('prefix', 'rongqiao-xueji/'))
    path_style = bool(raw.get('path_style', True))
    auto_sync = bool(raw.get('auto_sync', False))

    if endpoint:
        parsed = urlparse(endpoint)
        if parsed.scheme not in ('https', 'http') or not parsed.netloc:
            raise ValueError('Endpoint 地址格式无效，例如 https://s3.bitiful.net。')
    elif require_credentials:
        raise ValueError('请填写 S3 Endpoint 地址（缤纷云 S4 默认为 https://s3.bitiful.net）。')

    if require_credentials:
        if not bucket or not re.fullmatch(r'[A-Za-z0-9._-]+', bucket):
            raise ValueError('存储桶名称（Bucket）不能为空，且只能包含字母、数字、点、短横线或下划线。')
        if not access_key:
            raise ValueError('请填写 Access Key。')
        if not secret_key:
            raise ValueError('请填写 Secret Key。')
        if not region:
            region = 'cn-east-1'

    return {
        'provider': provider,
        'endpoint': endpoint,
        'region': region,
        'bucket': bucket,
        'access_key': access_key,
        'secret_key': secret_key,
        'prefix': prefix,
        'path_style': path_style,
        'auto_sync': auto_sync,
    }


def mask_config(cfg: dict | None) -> dict:
    if not isinstance(cfg, dict) or not cfg.get('endpoint'):
        return {
            **BITIFUL_PRESET,
            'bucket': '',
            'access_key': '',
            'has_secret': False,
            'secret_key_masked': '',
            'auto_sync': False,
            'configured': False,
        }
    secret = str(cfg.get('secret_key') or '')
    masked = ('••••••••' + secret[-4:]) if len(secret) > 4 else ('••••' if secret else '')
    return {
        'provider': cfg.get('provider', 'bitiful'),
        'endpoint': cfg.get('endpoint', ''),
        'region': cfg.get('region', 'cn-east-1'),
        'bucket': cfg.get('bucket', ''),
        'access_key': cfg.get('access_key', ''),
        'has_secret': bool(secret),
        'secret_key_masked': masked,
        'prefix': cfg.get('prefix', 'rongqiao-xueji/'),
        'path_style': bool(cfg.get('path_style', True)),
        'auto_sync': bool(cfg.get('auto_sync', False)),
        'configured': bool(cfg.get('endpoint') and cfg.get('bucket') and cfg.get('access_key') and secret),
    }


def _build_url_and_host(cfg: dict, key: str = '') -> tuple[str, str, str]:
    parsed = urlparse(cfg['endpoint'])
    scheme = parsed.scheme
    base_host = parsed.netloc
    base_path = parsed.path.rstrip('/')
    bucket = cfg['bucket']
    clean_key = key.lstrip('/')

    if cfg.get('path_style', True):
        host = base_host
        raw_path = f'{base_path}/{bucket}/{clean_key}' if clean_key else f'{base_path}/{bucket}'
    else:
        host = f'{bucket}.{base_host}'
        raw_path = f'{base_path}/{clean_key}' if clean_key else (base_path or '/')

    canonical_path = _uri_encode_path(raw_path if raw_path.startswith('/') else '/' + raw_path)
    return f'{scheme}://{host}{canonical_path}', host, canonical_path


def sign_s3_request(
    cfg: dict,
    method: str,
    key: str = '',
    *,
    query: dict[str, str] | None = None,
    body: bytes = b'',
    content_type: str | None = None,
    now_dt: datetime | None = None,
) -> tuple[str, dict[str, str]]:
    """Return (full_url, signed_headers) using AWS Signature Version 4."""
    dt = (now_dt or datetime.now(timezone.utc)).astimezone(timezone.utc)
    amz_date = dt.strftime('%Y%m%dT%H%M%SZ')
    date_stamp = dt.strftime('%Y%m%d')
    region = cfg.get('region') or 'cn-east-1'
    payload_hash = _sha256_hex(body)

    url_base, host, canonical_path = _build_url_and_host(cfg, key)
    canonical_qs = _canonical_query(query)
    full_url = f'{url_base}?{canonical_qs}' if canonical_qs else url_base

    headers_to_sign = {
        'host': host,
        'x-amz-content-sha256': payload_hash,
        'x-amz-date': amz_date,
    }
    if content_type:
        headers_to_sign['content-type'] = content_type

    sorted_keys = sorted(headers_to_sign.keys())
    canonical_headers = ''.join(f'{k}:{headers_to_sign[k].strip()}\n' for k in sorted_keys)
    signed_headers = ';'.join(sorted_keys)

    canonical_request = '\n'.join([
        method.upper(),
        canonical_path,
        canonical_qs,
        canonical_headers,
        signed_headers,
        payload_hash,
    ])
    credential_scope = f'{date_stamp}/{region}/s3/aws4_request'
    string_to_sign = '\n'.join([
        'AWS4-HMAC-SHA256',
        amz_date,
        credential_scope,
        _sha256_hex(canonical_request.encode('utf-8')),
    ])
    sig_key = _signing_key(cfg['secret_key'], date_stamp, region, 's3')
    signature = hmac.new(sig_key, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()

    out_headers = {
        'Host': host,
        'X-Amz-Date': amz_date,
        'X-Amz-Content-Sha256': payload_hash,
        'Authorization': (
            f"AWS4-HMAC-SHA256 Credential={cfg['access_key']}/{credential_scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        ),
    }
    if content_type:
        out_headers['Content-Type'] = content_type
    return full_url, out_headers


def _extract_s3_error(raw_body: bytes) -> tuple[str, str]:
    try:
        root = ET.fromstring(raw_body)
        code = root.findtext('Code') or ''
        msg = root.findtext('Message') or ''
        return code.strip(), msg.strip()
    except Exception:
        return '', raw_body.decode('utf-8', errors='replace')[:180].strip()


def _request(
    cfg: dict,
    method: str,
    key: str = '',
    *,
    query: dict[str, str] | None = None,
    body: bytes = b'',
    content_type: str | None = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> tuple[int, dict[str, str], bytes]:
    url, headers = sign_s3_request(cfg, method, key, query=query, body=body, content_type=content_type)
    req = Request(url, data=body if method.upper() in ('PUT', 'POST') else None, headers=headers, method=method.upper())
    try:
        with urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers.items()), resp.read()
    except HTTPError as exc:
        err_body = exc.read()
        code, msg = _extract_s3_error(err_body)
        if exc.code == 403:
            hint = 'Access Key / Secret Key 不正确，或该密钥没有此存储桶的读写权限。'
        elif exc.code == 404:
            hint = '找不到指定的存储桶或云端文件，请核对存储桶名称与 Endpoint。'
        elif exc.code == 400 and 'Region' in (code + msg):
            hint = '区域（Region）不匹配，缤纷云 S4 请填写 cn-east-1。'
        else:
            hint = f'对象存储返回 HTTP {exc.code}'
        detail = f'（{code}: {msg}）' if code or msg else ''
        raise ValueError(f'{hint}{detail}') from exc
    except URLError as exc:
        raise ValueError(f'无法连接到对象存储服务，请检查网络或 Endpoint 地址：{exc.reason}') from exc
    except TimeoutError as exc:
        raise ValueError('连接对象存储超时，请检查网络后重试。') from exc


def list_snapshots(cfg: dict, *, max_keys: int = 100) -> list[dict]:
    cfg = validate_config(cfg, require_credentials=True)
    _, _, raw = _request(
        cfg,
        'GET',
        '',
        query={'list-type': '2', 'prefix': cfg['prefix'], 'max-keys': str(max_keys)},
    )
    items: list[dict] = []
    if not raw.strip():
        return items
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ValueError('对象存储返回的目录列表格式无法解析，请确认 Endpoint 为 S3 接口地址。') from exc
    ns = ''
    if root.tag.startswith('{'):
        ns = root.tag.split('}')[0] + '}'
    for node in root.findall(f'{ns}Contents'):
        key = node.findtext(f'{ns}Key') or ''
        if not (key.endswith('.json') or key.endswith('.json.gz')):
            continue
        size = int(node.findtext(f'{ns}Size') or 0)
        modified = (node.findtext(f'{ns}LastModified') or '').strip()
        name = key[len(cfg['prefix']):] if key.startswith(cfg['prefix']) else key
        items.append({
            'key': key,
            'name': name,
            'size': size,
            'last_modified': modified,
            'is_latest': name in ('latest.json.gz', 'latest.json'),
        })
    items.sort(key=lambda x: (not x['is_latest'], x['last_modified']), reverse=False)
    # Sort non-latest newest first, keep latest pinned at top if present
    latest = [x for x in items if x['is_latest']]
    others = sorted([x for x in items if not x['is_latest']], key=lambda x: x['last_modified'], reverse=True)
    return latest + others


def test_connection(cfg: dict) -> dict:
    cfg = validate_config(cfg, require_credentials=True)
    items = list_snapshots(cfg, max_keys=50)
    return {
        'ok': True,
        'bucket': cfg['bucket'],
        'prefix': cfg['prefix'],
        'snapshot_count': len([x for x in items if not x['is_latest']]),
        'has_latest': any(x['is_latest'] for x in items),
        'message': f"连接成功！已访问存储桶 {cfg['bucket']}（目录 {cfg['prefix']}，现有 {len(items)} 个云端备份文件）。",
    }


def put_snapshot(cfg: dict, backup_obj: dict, *, label: str = '') -> dict:
    cfg = validate_config(cfg, require_credentials=True)
    raw_json = json.dumps(backup_obj, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
    compressed = gzip.compress(raw_json, compresslevel=6)
    if len(compressed) > MAX_SNAPSHOT_BYTES:
        raise ValueError('备份文件压缩后超过 64MB 限制，请清理历史归档后重试。')

    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    safe_label = re.sub(r'[^\w\u4e00-\u9fff-]+', '_', str(label or '').strip())[:32].strip('_')
    filename = f'snapshot_{stamp}_{safe_label}.json.gz' if safe_label else f'snapshot_{stamp}.json.gz'
    snapshot_key = f"{cfg['prefix']}snapshots/{filename}"
    latest_key = f"{cfg['prefix']}latest.json.gz"

    _request(cfg, 'PUT', snapshot_key, body=compressed, content_type='application/gzip', timeout=60)
    _request(cfg, 'PUT', latest_key, body=compressed, content_type='application/gzip', timeout=60)

    return {
        'ok': True,
        'key': snapshot_key,
        'latest_key': latest_key,
        'size': len(compressed),
        'raw_size': len(raw_json),
        'exam_count': len(backup_obj.get('exams') or []),
        'synced_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
    }


def get_snapshot(cfg: dict, key: str | None = None) -> tuple[str, dict]:
    cfg = validate_config(cfg, require_credentials=True)
    target_key = str(key or '').strip() or f"{cfg['prefix']}latest.json.gz"
    if not target_key.startswith(cfg['prefix']):
        raise ValueError('只能读取本软件配置目录下的云端备份文件。')
    _, _, raw = _request(cfg, 'GET', target_key, timeout=60)
    if len(raw) > MAX_SNAPSHOT_BYTES:
        raise ValueError('云端备份文件过大，已取消读取。')
    if raw[:2] == b'\x1f\x8b':
        try:
            raw = gzip.decompress(raw)
        except OSError as exc:
            raise ValueError('云端备份压缩包已损坏，无法解压。') from exc
    try:
        parsed = json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError('云端文件内容不是有效的融侨学迹 JSON 备份。') from exc
    if not isinstance(parsed, dict):
        raise ValueError('云端备份数据结构无效。')
    return target_key, parsed


def delete_snapshot(cfg: dict, key: str) -> dict:
    cfg = validate_config(cfg, require_credentials=True)
    target_key = str(key or '').strip()
    if not target_key or not target_key.startswith(cfg['prefix']):
        raise ValueError('只能删除本软件配置目录下的云端备份文件。')
    _request(cfg, 'DELETE', target_key)
    return {'ok': True, 'deleted': target_key}
