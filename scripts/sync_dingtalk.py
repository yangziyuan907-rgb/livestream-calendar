#!/usr/bin/env python3
"""Sync DingTalk AI Table (多维表/Notable) or local CSV into Calendar JSON + ICS.

Zero third-party dependencies (Python 3.9+ stdlib only).

Modes:
  1. DingTalk API Mode (automatic when DINGTALK_APP_KEY + DINGTALK_APP_SECRET
     + (DINGTALK_OPERATOR_ID or DINGTALK_MOBILE) are provided)
  2. CSV Mode (automatic fallback, or --csv <path> explicitly)

Outputs:
  - docs/data/schedule.json      (consumed by GitHub Pages via fetch)
  - docs/data/schedule-data.js   (enables direct local file:// preview without a server)
  - docs/calendar.ics            (RFC 5545 subscription feed for Apple/Google/Notion/DingTalk Calendar)
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from zoneinfo import ZoneInfo

    SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")
except Exception:
    SHANGHAI_TZ = dt.timezone(dt.timedelta(hours=8))

DEFAULT_BASE_ID = "MNDoBb60VLrYNqLqInx6PzPA8lemrZQ3"
DEFAULT_SHEET_ID = "AEFsFrm"
DEFAULT_PRO_WORKBOOK_ID = "EpGBa2Lm8azZ5n4nFwmY4KDkWgN7R35y"   # 专业课直播汇总表
DEFAULT_GRID_WORKBOOK_ID = "2Amq4vjg89gjdp9pSmqQqAv5V3kdP0wQ"  # 咨询师之家直播时间表（新版）
DEFAULT_SOURCE_URL = (
    "https://alidocs.dingtalk.com/i/nodes/MNDoBb60VLrYNqLqInx6PzPA8lemrZQ3"
    "?utm_scene=person_space&iframeQuery=viewId%3Dc9vuiLa%26sheetId%3DAEFsFrm"
)

ROOM_SHORT_MAP = {
    "19楼": "19F",
    "21楼·就事论事": "21F·就事",
    "21楼·赏心悦室": "21F·赏心",
}

FIELD_ALIASES = {
    "title": ["直播主题", "主题", "标题"],
    "date": ["日期", "直播日期", "开播日期"],
    "type": ["直播类型", "类型", "分类"],
    "start": ["开始时间", "开播时间"],
    "end": ["结束时间", "下播时间"],
    "videoAccount": ["视频号账号", "视频号"],
    "videoAccountLegacy": ["视频号账号(旧)"],
    "appAccount": ["APP账号", "App账号", "APP"],
    "speaker": ["讲师", "主讲", "老师"],
    "host": ["主持人", "主持"],
    "inviteStatus": ["老师邀约状态", "邀约状态"],
    "ops": ["运营", "对接运营", "负责人"],
    "room": ["直播间", "房间", "场地"],
    "detail": ["详情", "备注"],
    "conflict": ["冲突标记"],
    "conflictReason": ["冲突原因"],
    "conflictGroup": ["冲突组"],
}


def load_dotenv(env_path: Path) -> None:
    """Load simple KEY=VALUE lines from .env if present (does not override existing env)."""
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def http_json(
    method: str,
    url: str,
    headers: Optional[Dict[str, str]] = None,
    payload: Optional[Dict[str, Any]] = None,
    timeout: int = 20,
) -> Dict[str, Any]:
    req_headers = {"Accept": "application/json"}
    if headers:
        req_headers.update(headers)
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {url}\n{err_body}") from exc


def get_dingtalk_access_token(app_key: str, app_secret: str) -> str:
    res = http_json(
        "POST",
        "https://api.dingtalk.com/v1.0/oauth2/accessToken",
        payload={"appKey": app_key, "appSecret": app_secret},
    )
    token = res.get("accessToken")
    if not token:
        raise RuntimeError(f"获取钉钉 accessToken 失败: {res}")
    return token


def resolve_union_id_by_userid(access_token: str, userid: str) -> str:
    """Resolve unionId from DingTalk staffId/userid via Contacts API (requires Contact.User.Read)."""
    q = urllib.parse.urlencode({"access_token": access_token})
    user_info = http_json(
        "POST",
        f"https://oapi.dingtalk.com/topapi/v2/user/get?{q}",
        payload={"userid": userid},
    )
    if user_info.get("errcode", 0) != 0:
        raise RuntimeError(
            f"通过 userid({userid}) 查询 unionid 失败（请确认已开通“通讯录个人信息读权限”且审批通过，或直接填写 DINGTALK_OPERATOR_ID）: {user_info}"
        )
    union_id = (user_info.get("result") or {}).get("unionid")
    if not union_id:
        raise RuntimeError(f"成员详情中未返回 unionid: {user_info}")
    return union_id


def resolve_union_id_by_mobile(access_token: str, mobile: str) -> str:
    """Resolve unionId from phone number via DingTalk Contacts API."""
    q = urllib.parse.urlencode({"access_token": access_token})
    by_mobile = http_json(
        "POST",
        f"https://oapi.dingtalk.com/topapi/v2/user/getbymobile?{q}",
        payload={"mobile": mobile},
    )
    if by_mobile.get("errcode", 0) != 0:
        raise RuntimeError(
            f"通过手机号查询 userid 失败（请确认应用已开通“根据手机号获取成员”权限，或直接填写 DINGTALK_OPERATOR_ID）: {by_mobile}"
        )
    userid = (by_mobile.get("result") or {}).get("userid")
    if not userid:
        raise RuntimeError(f"未找到手机号 {mobile} 对应的钉钉成员: {by_mobile}")
    return resolve_union_id_by_userid(access_token, userid)


def fetch_dingtalk_fields(
    access_token: str, base_id: str, sheet_id: str, operator_id: str
) -> List[Dict[str, Any]]:
    """Fetch field definitions for a DingTalk AI Table sheet."""
    q = urllib.parse.urlencode({"operatorId": operator_id})
    url = f"https://api.dingtalk.com/v1.0/notable/bases/{base_id}/sheets/{sheet_id}/fields?{q}"
    try:
        res = http_json(
            "GET",
            url,
            headers={"x-acs-dingtalk-access-token": access_token},
        )
    except Exception as exc:
        print(f"[warn] 获取字段列表失败 (sheet={sheet_id}): {exc}", file=sys.stderr)
        return []
    return list(res.get("value") or res.get("fields") or [])


def fetch_dingtalk_sheets(
    access_token: str, base_id: str, operator_id: str
) -> List[Dict[str, Any]]:
    """List all sheets in a DingTalk AI Table base."""
    q = urllib.parse.urlencode({"operatorId": operator_id})
    url = f"https://api.dingtalk.com/v1.0/notable/bases/{base_id}/sheets?{q}"
    try:
        res = http_json(
            "GET",
            url,
            headers={"x-acs-dingtalk-access-token": access_token},
        )
    except Exception as exc:
        print(f"[warn] 获取工作表列表失败: {exc}", file=sys.stderr)
        return []
    return list(res.get("value") or res.get("sheets") or [])


def _fetch_raw_sheet_records(
    access_token: str, base_id: str, sheet_id: str, operator_id: str
) -> List[Dict[str, Any]]:
    """Fetch raw record objects (id + fields) for a single sheet with pagination."""
    q = urllib.parse.urlencode({"operatorId": operator_id})
    url = f"https://api.dingtalk.com/v1.0/notable/bases/{base_id}/sheets/{sheet_id}/records/list?{q}"
    headers = {"x-acs-dingtalk-access-token": access_token}

    records_out: List[Dict[str, Any]] = []
    next_token = ""
    while True:
        body: Dict[str, Any] = {"maxResults": 100}
        if next_token:
            body["nextToken"] = next_token
        res = http_json("POST", url, headers=headers, payload=body)
        records = res.get("records") or []
        records_out.extend(records)

        has_more = bool(res.get("hasMore"))
        next_token = str(res.get("nextToken") or "")
        if not has_more or not next_token:
            break
    return records_out


def _extract_linked_ids(val: Any, is_link_field: bool = False) -> List[str]:
    """Extract linked record IDs from DingTalk unidirectionalLink / bidirectionalLink values."""
    if val is None:
        return []
    if isinstance(val, dict):
        for key in ("linkedRecordIds", "recordIds"):
            ids = val.get(key)
            if isinstance(ids, list):
                return [str(x) for x in ids if x]
        # Single linked record object without display text
        if ("recordId" in val or "id" in val) and not any(
            val.get(k) for k in ("name", "text", "primaryValue", "label", "title")
        ):
            rid = val.get("recordId") or val.get("id")
            return [str(rid)] if rid else []
    if isinstance(val, list):
        out: List[str] = []
        for item in val:
            if isinstance(item, str) and is_link_field:
                out.append(item)
            elif isinstance(item, dict):
                if any(item.get(k) for k in ("name", "text", "primaryValue", "label", "title")):
                    continue
                rid = item.get("recordId") or item.get("id")
                if rid:
                    out.append(str(rid))
        return out
    return []


def _pick_primary_display(fields_dict: Dict[str, Any], sheet_fields: List[Dict[str, Any]]) -> str:
    """Pick the primary display label of a linked lookup record (e.g. 名称/账号名称/姓名)."""
    field_id_to_name = {
        str(f.get("id")): str(f.get("name"))
        for f in sheet_fields
        if f.get("id") and f.get("name")
    }
    named: Dict[str, Any] = {}
    for k, v in fields_dict.items():
        named[field_id_to_name.get(str(k), str(k))] = v

    # 1. Explicit primary field from schema
    for f in sheet_fields:
        if f.get("isPrimary") or f.get("primary"):
            fname = str(f.get("name") or "")
            if fname in named:
                txt = extract_text(named[fname])
                if txt:
                    return txt

    # 2. Well-known primary column names in DingTalk lookup sheets
    for preferred in ("名称", "账号名称", "姓名", "直播间", "标题", "主题"):
        if preferred in named:
            txt = extract_text(named[preferred])
            if txt:
                return txt

    # 3. First defined field in schema
    if sheet_fields:
        first_name = str(sheet_fields[0].get("name") or "")
        if first_name in named:
            txt = extract_text(named[first_name])
            if txt:
                return txt

    # 4. First non-empty scalar text field
    for v in named.values():
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def resolve_linked_records_in_rows(
    rows: List[Dict[str, Any]],
    record_lookup: Dict[str, str],
    link_field_names: Optional[set] = None,
) -> int:
    """Replace linkedRecordIds objects in normalized rows with human-readable display labels."""
    link_names = link_field_names or set()
    resolved_cells = 0
    for row in rows:
        for k, v in list(row.items()):
            if k.startswith("_"):
                continue
            ids = _extract_linked_ids(v, is_link_field=(k in link_names))
            if not ids:
                continue
            labels = [record_lookup.get(rid, "") for rid in ids]
            labels = [lb for lb in labels if lb]
            if labels:
                # Deduplicate preserving order
                deduped = list(dict.fromkeys(labels))
                row[k] = "、".join(deduped)
                resolved_cells += 1
    return resolved_cells


def fetch_dingtalk_records(
    access_token: str, base_id: str, sheet_id: str, operator_id: str
) -> List[Dict[str, Any]]:
    """Fetch all records from a DingTalk AI Table sheet and resolve linked record fields."""
    sheet_fields = fetch_dingtalk_fields(access_token, base_id, sheet_id, operator_id)
    field_map: Dict[str, str] = {}
    link_field_names: set = set()
    linked_sheet_ids: List[str] = []

    for f in sheet_fields:
        fid = str(f.get("id") or "")
        fname = str(f.get("name") or "")
        ftype = str(f.get("type") or "")
        if fid and fname:
            field_map[fid] = fname
        prop = f.get("property") or {}
        if "link" in ftype.lower() or any(
            k in prop for k in ("linkedSheetId", "targetSheetId", "sheetId", "linkedTableId")
        ):
            if fname:
                link_field_names.add(fname)
            if fid:
                link_field_names.add(fid)
            for key in ("linkedSheetId", "targetSheetId", "sheetId", "linkedTableId"):
                sid = prop.get(key)
                if sid and str(sid) != sheet_id and str(sid) not in linked_sheet_ids:
                    linked_sheet_ids.append(str(sid))

    raw_records = _fetch_raw_sheet_records(access_token, base_id, sheet_id, operator_id)
    all_rows: List[Dict[str, Any]] = []
    needs_lookup = False
    for rec in raw_records:
        raw_fields = rec.get("fields") or {}
        normalized: Dict[str, Any] = {"_recordId": rec.get("id", "")}
        for k, v in raw_fields.items():
            name = field_map.get(str(k), str(k))
            normalized[name] = v
            if _extract_linked_ids(v, is_link_field=(name in link_field_names)):
                needs_lookup = True
        all_rows.append(normalized)

    if needs_lookup:
        if not linked_sheet_ids:
            # Fallback: discover all other sheets in the base (e.g. 直播间/账号/讲师/主持人/运营)
            for s in fetch_dingtalk_sheets(access_token, base_id, operator_id):
                sid = str(s.get("id") or "")
                if sid and sid != sheet_id and sid not in linked_sheet_ids:
                    linked_sheet_ids.append(sid)

        record_lookup: Dict[str, str] = {}
        for lsid in linked_sheet_ids:
            lfields = fetch_dingtalk_fields(access_token, base_id, lsid, operator_id)
            lrecs = _fetch_raw_sheet_records(access_token, base_id, lsid, operator_id)
            for lrec in lrecs:
                rid = str(lrec.get("id") or "")
                if not rid:
                    continue
                label = _pick_primary_display(lrec.get("fields") or {}, lfields)
                if label:
                    record_lookup[rid] = label

        resolved_cells = resolve_linked_records_in_rows(all_rows, record_lookup, link_field_names)
        print(
            f"[info] 已解析 {len(linked_sheet_ids)} 张关联子表（{len(record_lookup)} 条映射），"
            f"共填充 {resolved_cells} 个关联字段值"
        )
    elif all_rows:
        sample = all_rows[0]
        shape = {
            k: (type(v).__name__, list(v.keys()) if isinstance(v, dict) else (type(v[0]).__name__ if isinstance(v, list) and v else ""))
            for k, v in sample.items()
            if k in ("直播间", "视频号账号", "APP账号", "讲师", "主持人", "运营")
        }
        print(f"[info] 未检测到需查表的关联 ID，样本字段结构: {shape}")

    return all_rows


# ---------------- DingTalk Online Spreadsheet (Workbook) Readers ----------------

def col_index_to_letter(col_1based: int) -> str:
    """Convert 1-based column index to Excel A1 column letters (1->A, 26->Z, 27->AA)."""
    out = ""
    n = max(1, col_1based)
    while n > 0:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out


def fetch_workbook_sheets(
    access_token: str, workbook_id: str, operator_id: str
) -> List[Dict[str, Any]]:
    q = urllib.parse.urlencode({"operatorId": operator_id})
    url = f"https://api.dingtalk.com/v1.0/doc/workbooks/{workbook_id}/sheets?{q}"
    res = http_json("GET", url, headers={"x-acs-dingtalk-access-token": access_token})
    return list(res.get("value") or res.get("sheets") or [])


def fetch_workbook_sheet_grid(
    access_token: str,
    workbook_id: str,
    sheet_id: str,
    operator_id: str,
    max_cols: int = 12,
    chunk_rows: int = 100,
) -> List[List[str]]:
    """Fetch a DingTalk online spreadsheet worksheet as a 2D list of display strings."""
    q = urllib.parse.urlencode({"operatorId": operator_id})
    sheet_enc = urllib.parse.quote(sheet_id, safe="")
    info_url = f"https://api.dingtalk.com/v1.0/doc/workbooks/{workbook_id}/sheets/{sheet_enc}?{q}"
    info = http_json("GET", info_url, headers={"x-acs-dingtalk-access-token": access_token})
    last_row = int(info.get("lastNonEmptyRow", -1))
    last_col = int(info.get("lastNonEmptyColumn", -1))
    if last_row < 0 or last_col < 0:
        return []

    total_rows = last_row + 1
    total_cols = min(last_col + 1, max_cols)
    end_col_letter = col_index_to_letter(total_cols)

    grid: List[List[str]] = []
    for start_r in range(1, total_rows + 1, chunk_rows):
        end_r = min(start_r + chunk_rows - 1, total_rows)
        rng = f"A{start_r}:{end_col_letter}{end_r}"
        rq = urllib.parse.urlencode({"operatorId": operator_id, "select": "displayValues,values"})
        r_url = f"https://api.dingtalk.com/v1.0/doc/workbooks/{workbook_id}/sheets/{sheet_enc}/ranges/{rng}?{rq}"
        try:
            res = http_json("GET", r_url, headers={"x-acs-dingtalk-access-token": access_token})
        except RuntimeError:
            rq_fb = urllib.parse.urlencode({"operatorId": operator_id})
            r_url_fb = f"https://api.dingtalk.com/v1.0/doc/workbooks/{workbook_id}/sheets/{sheet_enc}/ranges/{rng}?{rq_fb}"
            res = http_json("GET", r_url_fb, headers={"x-acs-dingtalk-access-token": access_token})
        disp = res.get("displayValues") or []
        vals = res.get("values") or []
        row_count = max(len(disp), len(vals))
        for i in range(row_count):
            d_row = disp[i] if i < len(disp) else []
            v_row = vals[i] if i < len(vals) else []
            merged_row: List[str] = []
            for j in range(total_cols):
                dv = d_row[j] if j < len(d_row) else ""
                vv = v_row[j] if j < len(v_row) else ""
                cell = dv if str(dv or "").strip() else vv
                merged_row.append(str(cell).strip() if cell is not None else "")
            grid.append(merged_row)
    return grid


def _parse_time_range(text: str) -> Tuple[str, str]:
    """Extract (start, end) HH:MM pair from strings like '18:00-20:00' or '18:00~19:40'."""
    if not text:
        return "", ""
    m = re.search(r"(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~—–至到]\s*(\d{1,2})\s*[:：]\s*(\d{2})", text)
    if m:
        s = f"{int(m.group(1)):02d}:{int(m.group(2)):02d}"
        e = f"{int(m.group(3)):02d}:{int(m.group(4)):02d}"
        return s, e
    m2 = re.search(r"(\d{1,2})\s*[:：]\s*(\d{2})", text)
    if m2:
        return f"{int(m2.group(1)):02d}:{int(m2.group(2)):02d}", ""
    return "", ""


def _parse_cn_date(text: str, default_year: int, default_month: int = 0) -> str:
    """Parse Chinese/standard date strings like '12月3日', '2026/12/3', '12.3' into YYYY-MM-DD."""
    s = (text or "").strip()
    if not s:
        return ""
    m_full = re.search(r"(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})", s)
    if m_full:
        return f"{int(m_full.group(1)):04d}-{int(m_full.group(2)):02d}-{int(m_full.group(3)):02d}"
    m_cn = re.search(r"(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?", s)
    if m_cn:
        mo, dy = int(m_cn.group(1)), int(m_cn.group(2))
        if 1 <= mo <= 12 and 1 <= dy <= 31:
            return f"{default_year:04d}-{mo:02d}-{dy:02d}"
    m_md = re.fullmatch(r"(\d{1,2})[/.](\d{1,2})", s)
    if m_md:
        mo, dy = int(m_md.group(1)), int(m_md.group(2))
        if 1 <= mo <= 12 and 1 <= dy <= 31:
            return f"{default_year:04d}-{mo:02d}-{dy:02d}"
    if default_month and re.fullmatch(r"\d{1,2}", s):
        dy = int(s)
        if 1 <= dy <= 31:
            return f"{default_year:04d}-{default_month:02d}-{dy:02d}"
    return ""


def _normalize_room_name(text: str) -> str:
    s = (text or "").strip()
    if not s:
        return ""
    if "19楼" in s or "19F" in s.upper():
        return "19楼"
    if "赏心悦室" in s:
        return "21楼·赏心悦室"
    if "就事论事" in s or "21楼" in s:
        return "21楼·就事论事"
    return ""


def parse_pro_course_targets_grid(
    grid: List[List[str]], default_year: int = 2026
) -> List[Dict[str, Any]]:
    """Parse `专业课直播汇总表` -> `26年月度直播目标` schedule blocks."""
    records: List[Dict[str, Any]] = []
    cur_year = default_year
    cur_month = 0
    col_map: Dict[str, int] = {}

    for row in grid:
        non_empty = [c.strip() for c in row if c.strip()]
        if not non_empty:
            continue

        # Detect year/month banner rows like "12月" or "2027年1月"
        if len(non_empty) <= 2:
            joined = " ".join(non_empty)
            m_ym = re.search(r"(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月", joined)
            if m_ym and "日" not in joined:
                new_m = int(m_ym.group(2))
                if m_ym.group(1):
                    cur_year = int(m_ym.group(1))
                elif cur_month == 12 and new_m == 1:
                    cur_year += 1
                cur_month = new_m
                continue

        # Detect schedule header row ("日期", "时间", "老师", ...)
        stripped = [c.strip() for c in row]
        if "日期" in stripped and ("老师" in stripped or "讲师" in stripped):
            col_map = {}
            for idx, h in enumerate(stripped):
                if h == "日期":
                    col_map["date"] = idx
                elif h == "时间":
                    col_map["time"] = idx
                elif h in ("老师", "讲师"):
                    col_map["speaker"] = idx
                elif "课程" in h:
                    col_map["course"] = idx
                elif h == "类型":
                    col_map["salesType"] = idx
                elif "目标" in h:
                    col_map["target"] = idx
                elif "状态" in h:
                    col_map["status"] = idx
                elif h in ("主持人", "主播"):
                    col_map["host"] = idx
            continue

        if not col_map or "date" not in col_map:
            continue

        def cell(key: str) -> str:
            idx = col_map.get(key)
            return stripped[idx] if idx is not None and idx < len(stripped) else ""

        date_str = _parse_cn_date(cell("date"), cur_year, cur_month)
        if not date_str:
            continue
        start, end = _parse_time_range(cell("time"))
        speaker = cell("speaker")
        course = cell("course")
        sales_type = cell("salesType")
        target = cell("target")
        status = cell("status")
        host = cell("host")
        if not any([speaker, course, status, host]):
            continue

        records.append(
            {
                "source": "专业课直播汇总表",
                "date": date_str,
                "start": start,
                "end": end,
                "speaker": speaker,
                "coursePrice": course,
                "salesType": sales_type,
                "salesTarget": target,
                "inviteStatus": status,
                "host": host,
                "category": "专业课",
            }
        )
    return records


def _resolve_week_dates(
    header_row: List[str], cur_year: int, cur_month: int
) -> Dict[int, str]:
    """Resolve Mon..Sun (cols 1..7) dates accurately across month/year boundaries using weekday alignment."""
    dates: Dict[int, str] = {}
    # Candidate (year, month) pairs: current, previous, next
    candidates: List[Tuple[int, int]] = []
    if 1 <= cur_month <= 12:
        prev_y, prev_m = (cur_year - 1, 12) if cur_month == 1 else (cur_year, cur_month - 1)
        next_y, next_m = (cur_year + 1, 1) if cur_month == 12 else (cur_year, cur_month + 1)
        candidates = [(cur_year, cur_month), (prev_y, prev_m), (next_y, next_m)]

    for col in range(1, min(8, len(header_row))):
        raw = header_row[col].strip()
        if not raw:
            continue
        # Explicit full or month-day date
        if any(ch in raw for ch in ("/", "-", ".", "月")):
            parsed = _parse_cn_date(raw, cur_year, cur_month)
            if parsed:
                dates[col] = parsed
                continue
        m_day = re.fullmatch(r"(\d{1,2})[日号]?", raw)
        if not m_day:
            continue
        day_num = int(m_day.group(1))
        expected_wd = col - 1  # col 1 -> Monday (0) .. col 7 -> Sunday (6)
        matched = ""
        for cy, cm in candidates:
            try:
                d_obj = dt.date(cy, cm, day_num)
            except ValueError:
                continue
            if d_obj.weekday() == expected_wd:
                matched = d_obj.strftime("%Y-%m-%d")
                break
        if not matched and 1 <= cur_month <= 12:
            # Fallback if sheet column order slightly differs
            try:
                matched = dt.date(cur_year, cur_month, day_num).strftime("%Y-%m-%d")
            except ValueError:
                matched = ""
        if matched:
            dates[col] = matched
    return dates


def _split_grid_cell_blocks(cell_text: str) -> List[str]:
    """Split a weekly-grid cell that may stack multiple sessions into separate session blocks."""
    lines = [ln.strip() for ln in cell_text.splitlines()]
    blocks: List[List[str]] = []
    cur: List[str] = []
    session_starter = re.compile(
        r"^(?:【(?:专业课|高价课|督导教学|咨询观摩|团督|平台产品|咨询伦理|朝阳)】|(?:\d+\s*[.、]\s*【))"
    )
    time_header = re.compile(r"^【时间】")
    for ln in lines:
        if not ln:
            if cur:
                blocks.append(cur)
                cur = []
            continue
        if cur:
            cur_joined = "\n".join(cur)
            has_time = bool(re.search(r"\d{1,2}:\d{2}", cur_joined))
            if session_starter.match(ln) and len(cur) >= 2 and (has_time or "讲师" in cur_joined or "场地" in cur_joined or "平台" in cur_joined):
                blocks.append(cur)
                cur = [ln]
                continue
            if time_header.match(ln) and has_time:
                blocks.append(cur)
                cur = [ln]
                continue
        cur.append(ln)
    if cur:
        blocks.append(cur)
    return ["\n".join(b) for b in blocks if b]


def _clean_person_token(raw: str) -> str:
    s = (raw or "").strip()
    s = re.split(r"(?:场控|主持人|主播|推流|运营|场地|直播间|平台|开播方式|时间|【|（|\()", s)[0]
    s = s.strip(" ：:、，,;-|/")
    return s


def _parse_grid_session_block(block: str, date_str: str, category: str) -> Dict[str, Any]:
    """Extract structured operational details from one free-form session block in 直播时间表."""
    start, end = _parse_time_range(block)

    speaker = ""
    m_spk = re.search(r"(?:【?讲师】?|主讲|老师)\s*[:：]?\s*([^\n\r]+)", block)
    if m_spk:
        speaker = _clean_person_token(m_spk.group(1))

    host = ""
    m_host = re.search(r"(?:【?主持人】?|主播)\s*[:：]?\s*([^\n\r]+)", block)
    if m_host:
        host = _clean_person_token(m_host.group(1))

    stage_control = ""
    m_ctrl = re.search(r"(?:场控)\s*[:：]?\s*([^\n\r]+)", block)
    if m_ctrl:
        stage_control = _clean_person_token(m_ctrl.group(1))

    stream_push = ""
    m_push = re.search(r"(?:推流)\s*[:：]?\s*([^\n\r]+)", block)
    if m_push:
        stream_push = _clean_person_token(m_push.group(1))

    room = _normalize_room_name(block)

    broadcast_mode = ""
    m_mode = re.search(r"(?:【?开播方式】?|【?平台】?)\s*[:：]?\s*([^\n\r]+)", block)
    if m_mode:
        bm = m_mode.group(1).strip()
        bm = re.sub(r"[（(]\s*(?:19楼|21楼)[^）)]*[）)]", "", bm).strip(" ：:")
        broadcast_mode = bm

    title_hint = ""
    m_title = re.search(r"【主题】\s*[:：]?\s*([^\n\r]+)", block)
    if m_title:
        title_hint = m_title.group(1).strip()
    else:
        for ln in block.splitlines():
            ln_s = ln.strip()
            if ln_s and not re.match(r"^(?:【?(?:时间|讲师|人员|负责|场地|开播方式|平台)】?|\d{1,2}:\d{2})", ln_s):
                title_hint = ln_s
                break

    note_clean = " | ".join([ln.strip() for ln in block.splitlines() if ln.strip()])
    if len(note_clean) > 360:
        note_clean = note_clean[:357] + "..."

    return {
        "source": "咨询师之家直播时间表",
        "date": date_str,
        "category": category,
        "start": start,
        "end": end,
        "titleHint": title_hint,
        "speaker": speaker,
        "host": host,
        "stageControl": stage_control,
        "streamPush": stream_push,
        "room": room,
        "broadcastMode": broadcast_mode,
        "scheduleNote": note_clean,
    }


def parse_weekly_calendar_grid(
    grid: List[List[str]], sheet_year: int
) -> List[Dict[str, Any]]:
    """Parse `咨询师之家直播时间表（新版）` -> `YYYY年直播时间` 2D weekly grid."""
    records: List[Dict[str, Any]] = []
    cur_year = sheet_year
    cur_month = 0
    week_dates: Dict[int, str] = {}

    for row in grid:
        if not row or not any(c.strip() for c in row):
            continue
        col0 = row[0].strip()

        # Month banner row (e.g. "12月" or "2026年12月")
        m_month = re.fullmatch(r"(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月", col0)
        if m_month:
            if m_month.group(1):
                cur_year = int(m_month.group(1))
            cur_month = int(m_month.group(2))
            continue

        # Also detect month banner in row if col0 is empty and only one cell says "12月"
        non_empty = [c.strip() for c in row if c.strip()]
        if len(non_empty) == 1:
            m_single = re.fullmatch(r"(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月", non_empty[0])
            if m_single:
                if m_single.group(1):
                    cur_year = int(m_single.group(1))
                cur_month = int(m_single.group(2))
                continue

        # Week header row: col0 like "53周" or cols 1..7 hold day numbers
        day_like = sum(
            1 for c in row[1:8] if re.fullmatch(r"\d{1,2}[日号]?|\d{1,2}[/.月]\d{1,2}[日号]?", c.strip())
        )
        if re.match(r"^\d+\s*周", col0) or day_like >= 4:
            # If cur_month wasn't explicitly set yet, infer month=1 at start of sheet
            if cur_month == 0:
                cur_month = 1
            resolved = _resolve_week_dates(row, cur_year, cur_month)
            if resolved:
                week_dates = resolved
                # Advance cur_month to the month of Sunday (or last date in this week) for continuity
                last_d = sorted(resolved.values())[-1]
                cur_year, cur_month = int(last_d[:4]), int(last_d[5:7])
            continue

        if not week_dates or not col0 or col0 in ("周", "日期", "星期"):
            continue

        # Category schedule row
        category = col0
        for col in range(1, min(8, len(row))):
            cell_text = row[col].strip()
            if not cell_text or col not in week_dates:
                continue
            d_str = week_dates[col]
            for block in _split_grid_cell_blocks(cell_text):
                parsed = _parse_grid_session_block(block, d_str, category)
                if any(
                    parsed[k]
                    for k in ("speaker", "host", "stageControl", "streamPush", "broadcastMode", "titleHint", "start")
                ):
                    records.append(parsed)
    return records


def _category_compatible(ev_type: str, ev_title: str, sup_cat: str, sup_title: str = "") -> int:
    """Return compatibility score (>0 compatible, <0 incompatible, 0 neutral)."""
    et = (ev_type or "") + " " + (ev_title or "")
    sc = (sup_cat or "") + " " + (sup_title or "")

    groups = [
        ("专业课", ("专业课", "高价课", "训练营线索", "催眠", "短焦", "CBT", "家庭治疗", "儿童分析师")),
        ("百场督导", ("百场督导", "咨询观摩", "督导教学", "闭门会")),
        ("团督", ("团督",)),
        ("咨询伦理", ("伦理",)),
        ("朝阳", ("朝阳", "初心咨询", "壹心理", "低转高", "学员访谈")),
        ("平台产品", ("平台产品",)),
    ]

    def detect_group(text: str) -> str:
        for gname, kws in groups:
            if any(kw in text for kw in kws):
                return gname
        return ""

    g_ev = detect_group(et)
    g_sup = detect_group(sc)
    if g_ev and g_sup:
        if g_ev == g_sup:
            return 30
        # 专业课训练营/高价课 vs 朝阳训练营 are distinct
        return -40
    return 0


def _keyword_overlap_score(text_a: str, text_b: str) -> int:
    if not text_a or not text_b:
        return 0
    keywords = [
        "CBT", "催眠", "短焦", "家庭治疗", "儿童分析师", "汤海鹏", "张海音", "张敬轩", "洪伟凯",
        "付艳", "王灵", "许静", "童俊", "司雅梅", "高岚", "督导教学", "咨询观摩", "闭门会",
        "伴侣治疗", "伦理", "初心", "壹心理", "自讲", "公开课", "答疑", "访谈", "低转高", "团督",
    ]
    hits = sum(1 for kw in keywords if kw.lower() in text_a.lower() and kw.lower() in text_b.lower())
    return min(hits * 25, 50)


def _times_compatible(a_start: str, a_end: str, b_start: str, b_end: str) -> int:
    """Return +50 exact start match, +30 overlap, 0 if supplement has no time, -100 if disjoint."""
    if not b_start:
        return 0
    if not a_start:
        return 10
    if a_start == b_start:
        return 50
    a_s, a_e = time_to_mins(a_start), time_to_mins(a_end)
    b_s, b_e = time_to_mins(b_start), time_to_mins(b_end)
    if a_s is None or b_s is None:
        return 0
    a_end_m = a_e if (a_e is not None and a_e > a_s) else a_s + 60
    b_end_m = b_e if (b_e is not None and b_e > b_s) else b_s + 60
    if a_s < b_end_m and b_s < a_end_m:
        return 30
    return -100


def merge_supplements(
    events: List[Dict[str, Any]],
    pro_rows: List[Dict[str, Any]],
    grid_rows: List[Dict[str, Any]],
) -> Tuple[int, int]:
    """Enrich main-table events with matched records from the 2 supplementary DingTalk workbooks."""
    pro_by_date: Dict[str, List[Dict[str, Any]]] = {}
    for r in pro_rows:
        pro_by_date.setdefault(r["date"], []).append(r)

    grid_by_date: Dict[str, List[Dict[str, Any]]] = {}
    for r in grid_rows:
        grid_by_date.setdefault(r["date"], []).append(r)

    enriched_from_grid = 0
    enriched_from_pro = 0

    for ev in events:
        ev.setdefault("stageControl", "")
        ev.setdefault("streamPush", "")
        ev.setdefault("broadcastMode", "")
        ev.setdefault("coursePrice", "")
        ev.setdefault("salesType", "")
        ev.setdefault("salesTarget", "")
        ev.setdefault("scheduleNote", "")
        ev.setdefault("supplementSources", [])

        if not ev.get("date"):
            continue

        # 1. Match against Spreadsheet 2 (咨询师之家直播时间表)
        best_grid = None
        best_grid_score = 0
        for cand in grid_by_date.get(ev["date"], []):
            t_score = _times_compatible(ev["start"], ev["end"], cand["start"], cand["end"])
            if t_score < 0:
                continue
            if ev["room"] and cand["room"] and ev["room"] != cand["room"]:
                continue
            if ev["speaker"] and cand["speaker"] and ev["speaker"] not in cand["speaker"] and cand["speaker"] not in ev["speaker"]:
                continue

            cat_score = _category_compatible(ev["type"], ev["displayTitle"], cand["category"], cand["titleHint"])
            if cat_score < 0:
                continue
            kw_score = _keyword_overlap_score(ev["displayTitle"], cand["titleHint"] + " " + cand["scheduleNote"])
            spk_bonus = 40 if (ev["speaker"] and cand["speaker"] and (ev["speaker"] in cand["speaker"] or cand["speaker"] in ev["speaker"])) else 0
            room_bonus = 10 if (ev["room"] and cand["room"] and ev["room"] == cand["room"]) else 0
            score = t_score + cat_score + kw_score + spk_bonus + room_bonus
            # Require strong confidence: either time+cat/kw (>=55) or untimed cat+kw (>=50)
            threshold = 50 if not cand["start"] else 55
            if score >= threshold and score > best_grid_score:
                best_grid_score = score
                best_grid = cand

        if best_grid:
            enriched_from_grid += 1
            if "咨询师之家直播时间表" not in ev["supplementSources"]:
                ev["supplementSources"].append("咨询师之家直播时间表")
            if not ev["speaker"] and best_grid["speaker"]:
                ev["speaker"] = best_grid["speaker"]
            if not ev["host"] and best_grid["host"]:
                ev["host"] = best_grid["host"]
            if best_grid["stageControl"]:
                ev["stageControl"] = best_grid["stageControl"]
                if not ev["ops"]:
                    ev["ops"] = best_grid["stageControl"]
            if best_grid["streamPush"]:
                ev["streamPush"] = best_grid["streamPush"]
            if not ev["room"] and best_grid["room"]:
                ev["room"] = best_grid["room"]
            if best_grid["broadcastMode"]:
                ev["broadcastMode"] = best_grid["broadcastMode"]
                if not ev["appAccount"] and ("APP" in best_grid["broadcastMode"].upper() or "咨家" in best_grid["broadcastMode"]):
                    if "仅视频号" not in best_grid["broadcastMode"]:
                        ev["appAccount"] = "咨询师之家APP"
                if not ev["videoAccount"] and "视频号" in best_grid["broadcastMode"]:
                    ev["videoAccount"] = "咨询师之家"
            if best_grid["scheduleNote"]:
                ev["scheduleNote"] = best_grid["scheduleNote"]

        # 2. Match against Spreadsheet 1 (专业课直播汇总表)
        best_pro = None
        best_pro_score = 0
        for cand in pro_by_date.get(ev["date"], []):
            t_score = _times_compatible(ev["start"], ev["end"], cand["start"], cand["end"])
            if t_score < 0:
                continue
            if ev["speaker"] and cand["speaker"] and ev["speaker"] not in cand["speaker"] and cand["speaker"] not in ev["speaker"]:
                continue
            cat_score = _category_compatible(ev["type"], ev["displayTitle"], cand["category"], cand["coursePrice"])
            if cat_score < 0:
                continue
            kw_score = _keyword_overlap_score(ev["displayTitle"], cand["coursePrice"] + " " + cand["speaker"])
            spk_bonus = 40 if (ev["speaker"] and cand["speaker"] and (ev["speaker"] in cand["speaker"] or cand["speaker"] in ev["speaker"])) else 0
            score = t_score + cat_score + kw_score + spk_bonus
            if score >= 55 and score > best_pro_score:
                best_pro_score = score
                best_pro = cand

        if best_pro:
            enriched_from_pro += 1
            if "专业课直播汇总表" not in ev["supplementSources"]:
                ev["supplementSources"].append("专业课直播汇总表")
            if not ev["speaker"] and best_pro["speaker"]:
                ev["speaker"] = best_pro["speaker"]
            if not ev["host"] and best_pro["host"]:
                ev["host"] = best_pro["host"]
            if best_pro["coursePrice"]:
                ev["coursePrice"] = best_pro["coursePrice"]
            if best_pro["salesType"]:
                ev["salesType"] = best_pro["salesType"]
            if best_pro["salesTarget"]:
                ev["salesTarget"] = best_pro["salesTarget"]
            if best_pro["inviteStatus"] and (not ev["inviteStatus"] or (ev["inviteStatus"] == "未邀约" and "已邀约" in best_pro["inviteStatus"])):
                ev["inviteStatus"] = "已邀约" if "已邀约" in best_pro["inviteStatus"] else best_pro["inviteStatus"]

        # Recompute anomalies if room was filled in by supplement
        if ev["room"] and "未分配直播间" in ev["anomalyReasons"]:
            ev["anomalyReasons"] = [a for a in ev["anomalyReasons"] if a != "未分配直播间"]
        ev["hasAnomaly"] = bool(ev["anomalyReasons"]) or bool(ev["isConflict"])

    return enriched_from_pro, enriched_from_grid


def fetch_supplementary_workbooks(
    access_token: str,
    operator_id: str,
    pro_workbook_id: str,
    grid_workbook_id: str,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Fetch and parse both supplementary DingTalk online spreadsheets safely."""
    pro_rows: List[Dict[str, Any]] = []
    grid_rows: List[Dict[str, Any]] = []

    if pro_workbook_id:
        try:
            sheets = fetch_workbook_sheets(access_token, pro_workbook_id, operator_id)
            target_sheets = [
                s for s in sheets if "月度直播目标" in str(s.get("name") or "")
            ]
            for s in target_sheets:
                sname = str(s.get("name") or "")
                sid = str(s.get("id") or sname)
                m_yr = re.search(r"(\d{2,4})\s*年", sname)
                yr = 2026
                if m_yr:
                    y_num = int(m_yr.group(1))
                    yr = y_num if y_num >= 2000 else 2000 + y_num
                grid = fetch_workbook_sheet_grid(access_token, pro_workbook_id, sid, operator_id, max_cols=12)
                parsed = parse_pro_course_targets_grid(grid, default_year=yr)
                pro_rows.extend(parsed)
            print(f"[info] 补充表1（专业课直播汇总表）读取成功：解析 {len(pro_rows)} 条排期目标")
        except Exception as exc:
            print(f"[warn] 读取补充表1（专业课直播汇总表）失败，将跳过补充: {exc}", file=sys.stderr)

    if grid_workbook_id:
        try:
            sheets = fetch_workbook_sheets(access_token, grid_workbook_id, operator_id)
            # SECURITY: strictly whitelist ONLY `YYYY年直播时间` tabs (never read 直播账号会议室!)
            for s in sheets:
                sname = str(s.get("name") or "").strip()
                m_yr = re.fullmatch(r"(202[6-9]|203\d)年直播时间", sname)
                if not m_yr:
                    continue
                sid = str(s.get("id") or sname)
                yr = int(m_yr.group(1))
                grid = fetch_workbook_sheet_grid(access_token, grid_workbook_id, sid, operator_id, max_cols=8)
                parsed = parse_weekly_calendar_grid(grid, sheet_year=yr)
                grid_rows.extend(parsed)
            print(f"[info] 补充表2（咨询师之家直播时间表）读取成功：解析 {len(grid_rows)} 条时间表记录")
        except Exception as exc:
            print(f"[warn] 读取补充表2（咨询师之家直播时间表）失败，将跳过补充: {exc}", file=sys.stderr)

    return pro_rows, grid_rows


def extract_text(val: Any) -> str:
    """Flatten DingTalk Notable field value (text/select/link/user/list/formula) into clean string."""
    if val is None:
        return ""
    if isinstance(val, bool):
        return "是" if val else "否"
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, str):
        return val.strip()
    if isinstance(val, dict):
        # Single select / link / linked record / formula result
        for key in ("name", "text", "primaryValue", "label", "title", "value"):
            if key in val and val[key] not in (None, ""):
                return extract_text(val[key])
        if "records" in val and isinstance(val["records"], list):
            return extract_text(val["records"])
        return ""
    if isinstance(val, list):
        parts = [extract_text(item) for item in val]
        parts = [p for p in parts if p]
        # Deduplicate while preserving order
        seen = set()
        deduped = []
        for p in parts:
            if p not in seen:
                seen.add(p)
                deduped.append(p)
        return "、".join(deduped)
    return str(val).strip()


def normalize_date(val: Any) -> str:
    """Convert DingTalk timestamp (ms/s), ISO-8601, or YYYY/MM/DD into YYYY-MM-DD (Asia/Shanghai)."""
    if val is None or val == "":
        return ""
    if isinstance(val, dict):
        for key in ("value", "text", "name"):
            if key in val:
                return normalize_date(val[key])
        return ""
    if isinstance(val, (int, float)):
        ts = float(val)
        if ts > 1e11:  # milliseconds
            ts /= 1000.0
        if ts > 1e8:
            return dt.datetime.fromtimestamp(ts, tz=SHANGHAI_TZ).strftime("%Y-%m-%d")
        return ""

    s = extract_text(val)
    if not s:
        return ""
    # Pure numeric string timestamp
    if re.fullmatch(r"\d{10,13}", s):
        return normalize_date(int(s))
    # ISO 8601 with timezone, e.g. 2026-12-01T16:00:00.000Z
    if "T" in s:
        try:
            iso = s.replace("Z", "+00:00")
            parsed = dt.datetime.fromisoformat(iso)
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone(SHANGHAI_TZ)
            return parsed.strftime("%Y-%m-%d")
        except ValueError:
            pass
    # Common date strings: 2026-12-1, 2026/12/01, 2026.12.01
    m = re.search(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", s)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return ""


def normalize_time(val: Any) -> str:
    """Normalize HH:MM string or timestamp into HH:MM."""
    if val is None or val == "":
        return ""
    if isinstance(val, (int, float)):
        ts = float(val)
        if ts > 1e11:
            ts /= 1000.0
        if ts > 1e8:
            return dt.datetime.fromtimestamp(ts, tz=SHANGHAI_TZ).strftime("%H:%M")
    s = extract_text(val)
    if not s:
        return ""
    if "T" in s:
        try:
            iso = s.replace("Z", "+00:00")
            parsed = dt.datetime.fromisoformat(iso)
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone(SHANGHAI_TZ)
            return parsed.strftime("%H:%M")
        except ValueError:
            pass
    m = re.search(r"(\d{1,2}):(\d{2})", s)
    if m:
        h, mm = int(m.group(1)), int(m.group(2))
        if 0 <= h <= 23 and 0 <= mm <= 59:
            return f"{h:02d}:{mm:02d}"
    return ""


def pick_field(row: Dict[str, Any], canonical: str) -> Any:
    for alias in FIELD_ALIASES[canonical]:
        if alias in row and row[alias] not in (None, ""):
            return row[alias]
    return ""


def load_csv_rows(csv_path: Path) -> List[Dict[str, Any]]:
    """Parse standalone schedule CSV OR multi-sheet concatenated DingTalk CSV export."""
    text = csv_path.read_text(encoding="utf-8-sig")
    reader = list(csv.reader(text.splitlines()))
    header_idx = -1
    for i, r in enumerate(reader):
        cleaned = [c.strip() for c in r]
        if "直播主题" in cleaned and "日期" in cleaned:
            header_idx = i
            break
    if header_idx == -1:
        raise ValueError(f"CSV 文件 {csv_path} 中未找到包含“直播主题”和“日期”的表头行")

    headers = [c.strip() for c in reader[header_idx]]
    stop_markers = {"姓名", "冲突对", "账号名称", "名称"}
    rows: List[Dict[str, Any]] = []
    for raw in reader[header_idx + 1 :]:
        if not raw or all(not c.strip() for c in raw):
            continue
        if raw[0].strip() in stop_markers and ("角色" in raw or "场次A" in raw or "平台" in raw or "说明" in raw):
            break
        row_dict = {}
        for idx, h in enumerate(headers):
            if h:
                row_dict[h] = raw[idx].strip() if idx < len(raw) else ""
        rows.append(row_dict)
    return rows


def time_to_mins(t: str) -> Optional[int]:
    if not t or ":" not in t:
        return None
    try:
        h, m = t.split(":")
        return int(h) * 60 + int(m)
    except ValueError:
        return None


def build_events(raw_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Transform raw DingTalk/CSV records into clean, conflict-checked calendar events."""
    events: List[Dict[str, Any]] = []
    for idx, row in enumerate(raw_rows, start=1):
        title = extract_text(pick_field(row, "title"))
        date_str = normalize_date(pick_field(row, "date"))
        live_type = extract_text(pick_field(row, "type"))
        start = normalize_time(pick_field(row, "start"))
        end = normalize_time(pick_field(row, "end"))

        if not any([title, date_str, live_type, start]):
            continue

        video_acc = extract_text(pick_field(row, "videoAccount"))
        legacy_video = extract_text(pick_field(row, "videoAccountLegacy"))
        if not video_acc and legacy_video:
            video_acc = f"{legacy_video}(旧)"

        app_acc = extract_text(pick_field(row, "appAccount"))
        speaker = extract_text(pick_field(row, "speaker"))
        host = extract_text(pick_field(row, "host"))
        invite_status = extract_text(pick_field(row, "inviteStatus"))
        ops = extract_text(pick_field(row, "ops"))
        room = extract_text(pick_field(row, "room"))
        detail = extract_text(pick_field(row, "detail"))
        conflict_flag = extract_text(pick_field(row, "conflict"))
        conflict_reason = extract_text(pick_field(row, "conflictReason"))
        record_id = str(row.get("_recordId") or "")

        display_title = title or f"（未命名 · {live_type or '直播'}）"
        stable_key = record_id or f"{date_str}|{start}|{end}|{room}|{display_title}|{idx}"
        uid = hashlib.md5(stable_key.encode("utf-8")).hexdigest()[:12]

        anomalies: List[str] = []
        if not date_str:
            anomalies.append("缺少日期")
        if not title:
            anomalies.append("未填直播主题")
        if not room:
            anomalies.append("未分配直播间")
        if start and end and start == end:
            anomalies.append("开始与结束时间相同")

        conflicts: List[str] = []
        if conflict_flag == "冲突":
            conflicts.append(conflict_reason or "原表格标记冲突")

        events.append(
            {
                "id": uid,
                "recordId": record_id,
                "title": title,
                "displayTitle": display_title,
                "date": date_str,
                "type": live_type,
                "start": start,
                "end": end,
                "videoAccount": video_acc,
                "appAccount": app_acc,
                "speaker": speaker,
                "host": host,
                "inviteStatus": invite_status,
                "ops": ops,
                "room": room,
                "detail": detail,
                "tableConflict": conflict_flag == "冲突",
                "conflictReasons": conflicts,
                "anomalyReasons": anomalies,
            }
        )

    # Dynamic conflict detection: same date + overlapping [start, end) on same room or same videoAccount
    def check_overlap(field_name: str, label: str) -> None:
        buckets: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
        for ev in events:
            val = ev[field_name]
            if not ev["date"] or not val:
                continue
            # Ignore legacy tag suffix when checking actual account collision
            norm_val = val.replace("(旧)", "")
            buckets.setdefault((ev["date"], norm_val), []).append(ev)

        for group in buckets.values():
            if len(group) < 2:
                continue
            for i in range(len(group)):
                for j in range(i + 1, len(group)):
                    a, b = group[i], group[j]
                    a_s, a_e = time_to_mins(a["start"]), time_to_mins(a["end"])
                    b_s, b_e = time_to_mins(b["start"]), time_to_mins(b["end"])
                    if a_s is None or b_s is None:
                        continue
                    a_end = a_e if (a_e is not None and a_e > a_s) else a_s + 60
                    b_end = b_e if (b_e is not None and b_e > b_s) else b_s + 60
                    if a_s < b_end and b_s < a_end:
                        msg_a = f"与【{b['displayTitle']}】({b['start']}-{b['end']}) 时段重叠（相同{label}：{a[field_name]}）"
                        msg_b = f"与【{a['displayTitle']}】({a['start']}-{a['end']}) 时段重叠（相同{label}：{b[field_name]}）"
                        if not any(b["displayTitle"] in r and label in r for r in a["conflictReasons"]):
                            a["conflictReasons"].append(msg_a)
                        if not any(a["displayTitle"] in r and label in r for r in b["conflictReasons"]):
                            b["conflictReasons"].append(msg_b)

    check_overlap("room", "直播间")
    check_overlap("videoAccount", "视频号账号")
    check_overlap("host", "主持人")

    for ev in events:
        ev["isConflict"] = bool(ev["conflictReasons"])
        ev["hasAnomaly"] = bool(ev["anomalyReasons"]) or ev["isConflict"]

    events.sort(key=lambda e: (e["date"] or "9999-99-99", e["start"] or "99:99", e["room"], e["displayTitle"]))
    return events


def escape_ics(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def fold_ics_line(line: str) -> str:
    """Fold RFC 5545 lines longer than 75 octets."""
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return line
    chunks: List[str] = []
    cur = ""
    limit = 75
    for ch in line:
        if len((cur + ch).encode("utf-8")) > limit:
            chunks.append(cur)
            cur = " " + ch
            limit = 75
        else:
            cur += ch
    if cur:
        chunks.append(cur)
    return "\r\n".join(chunks)


def generate_ics(events: List[Dict[str, Any]], cal_name: str = "直播排期日历") -> str:
    now_utc = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//DingTalk Livestream Calendar//Auto Sync//CN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape_ics(cal_name)}",
        "X-WR-TIMEZONE:Asia/Shanghai",
        "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
        "X-PUBLISHED-TTL:PT30M",
        "BEGIN:VTIMEZONE",
        "TZID:Asia/Shanghai",
        "BEGIN:STANDARD",
        "DTSTART:19700101T000000",
        "TZOFFSETFROM:+0800",
        "TZOFFSETTO:+0800",
        "TZNAME:CST",
        "END:STANDARD",
        "END:VTIMEZONE",
    ]

    for ev in events:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", ev["date"]):
            continue
        date_compact = ev["date"].replace("-", "")
        start_hm = ev["start"] or "09:00"
        end_hm = ev["end"] or start_hm
        s_mins = time_to_mins(start_hm) or 540
        e_mins = time_to_mins(end_hm)
        if e_mins is None or e_mins <= s_mins:
            e_mins = min(s_mins + 60, 23 * 60 + 59)
            end_hm = f"{e_mins // 60:02d}:{e_mins % 60:02d}"

        dt_start = f"{date_compact}T{start_hm.replace(':', '')}00"
        dt_end = f"{date_compact}T{end_hm.replace(':', '')}00"
        room_tag = ROOM_SHORT_MAP.get(ev["room"], ev["room"] or "待定")
        prefix = "[冲突] " if ev["isConflict"] else ""
        summary = f"{prefix}[{room_tag}] {ev['displayTitle']}"

        accounts = " / ".join(
            [x for x in [f"视频号:{ev['videoAccount']}" if ev["videoAccount"] else "", f"APP:{ev['appAccount']}" if ev["appAccount"] else ""] if x]
        )
        desc_parts = [
            f"直播类型：{ev['type'] or '未分类'}",
            f"直播间：{ev['room'] or '未分配'}",
            f"讲师：{ev['speaker'] or '待定'} | 主持人：{ev['host'] or '待定'} | 运营：{ev['ops'] or '待定'}",
            f"老师邀约状态：{ev['inviteStatus'] or '未填写'}",
            f"开播账号：{accounts or '待定'}",
        ]
        if ev["conflictReasons"]:
            desc_parts.append("冲突提醒：" + "；".join(ev["conflictReasons"]))
        if ev["anomalyReasons"]:
            desc_parts.append("数据提醒：" + "；".join(ev["anomalyReasons"]))

        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:dingtalk-live-{ev['id']}@schedule",
                f"DTSTAMP:{now_utc}",
                f"DTSTART;TZID=Asia/Shanghai:{dt_start}",
                f"DTEND;TZID=Asia/Shanghai:{dt_end}",
                fold_ics_line(f"SUMMARY:{escape_ics(summary)}"),
                fold_ics_line(f"LOCATION:{escape_ics(ev['room'] or '待定')}"),
                fold_ics_line(f"DESCRIPTION:{escape_ics(chr(10).join(desc_parts))}"),
                f"CATEGORIES:{escape_ics(ev['type'] or '直播')}",
                "END:VEVENT",
            ]
        )

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def compute_content_hash(events: List[Dict[str, Any]], source_mode: str, source_url: str) -> str:
    canonical = json.dumps(
        {"sourceMode": source_mode, "sourceUrl": source_url, "events": events},
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def run_crypto_helper(mode: str, text: str, password: str) -> str:
    helper = Path(__file__).resolve().parent / "encrypt_aes_gcm.mjs"
    env = dict(os.environ)
    env["CALENDAR_PASSWORD"] = password
    proc = subprocess.run(
        ["node", str(helper), mode],
        input=text,
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"AES-GCM {mode} 失败: {proc.stderr.strip()}")
    return proc.stdout


def write_outputs(
    events: List[Dict[str, Any]],
    out_dir: Path,
    source_mode: str,
    source_url: str,
    password: str = "",
    force: bool = False,
) -> bool:
    """Write encrypted or plaintext calendar data. Returns True if files were updated."""
    data_dir = out_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    json_path = data_dir / "schedule.json"
    js_path = data_dir / "schedule-data.js"
    enc_path = data_dir / "schedule.enc.json"
    ics_path = out_dir / "calendar.ics"

    content_hash = compute_content_hash(events, source_mode, source_url)

    if password:
        # Remove any leftover plaintext artifacts so secrets never leak to public Pages
        for stale in (json_path, js_path, ics_path):
            if stale.exists():
                stale.unlink()

        if not force and enc_path.exists():
            try:
                prev_plain = run_crypto_helper("decrypt", enc_path.read_text(encoding="utf-8"), password)
                prev = json.loads(prev_plain)
                if (prev.get("meta") or {}).get("contentHash") == content_hash:
                    return False
            except Exception:
                # Password changed or file corrupted -> re-encrypt
                pass

        synced_at = dt.datetime.now(SHANGHAI_TZ).strftime("%Y-%m-%d %H:%M:%S")
        payload = {
            "meta": {
                "syncedAt": synced_at,
                "timezone": "Asia/Shanghai",
                "sourceMode": source_mode,
                "sourceUrl": source_url,
                "contentHash": content_hash,
                "encrypted": True,
                "total": len(events),
                "conflicts": sum(1 for e in events if e["isConflict"]),
                "anomalies": sum(1 for e in events if e["hasAnomaly"]),
            },
            "events": events,
        }
        plain_json = json.dumps(payload, ensure_ascii=False)
        encrypted_json = run_crypto_helper("encrypt", plain_json, password)
        enc_path.write_text(encrypted_json, encoding="utf-8")
        return True

    # Plaintext mode (when CALENDAR_PASSWORD is not configured)
    if enc_path.exists():
        enc_path.unlink()

    if not force and json_path.exists() and js_path.exists() and ics_path.exists():
        try:
            prev = json.loads(json_path.read_text(encoding="utf-8"))
            if (prev.get("meta") or {}).get("contentHash") == content_hash:
                return False
        except Exception:
            pass

    synced_at = dt.datetime.now(SHANGHAI_TZ).strftime("%Y-%m-%d %H:%M:%S")
    payload = {
        "meta": {
            "syncedAt": synced_at,
            "timezone": "Asia/Shanghai",
            "sourceMode": source_mode,
            "sourceUrl": source_url,
            "contentHash": content_hash,
            "encrypted": False,
            "total": len(events),
            "conflicts": sum(1 for e in events if e["isConflict"]),
            "anomalies": sum(1 for e in events if e["hasAnomaly"]),
        },
        "events": events,
    }

    json_text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    json_path.write_text(json_text, encoding="utf-8")
    js_path.write_text(f"window.__SCHEDULE_DATA__ = {json_text};\n", encoding="utf-8")

    ics_text = generate_ics(events)
    ics_path.write_text(ics_text, encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="同步钉钉 AI 表格或本地 CSV 到日历 JSON（支持 AES-256-GCM 加密）与 ICS")
    parser.add_argument("--csv", type=Path, default=None, help="强制从指定 CSV 文件生成（跳过钉钉 API）")
    parser.add_argument("--out", type=Path, default=Path("docs"), help="输出目录（默认 docs）")
    parser.add_argument("--password", type=str, default=None, help="启用 AES-256-GCM 加密的访问密码（默认读取 CALENDAR_PASSWORD）")
    parser.add_argument("--require-encryption", action="store_true", help="强制要求加密密码，防止意外明文发布")
    parser.add_argument("--force", action="store_true", help="即使内容无变化也强制重新写入文件")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv(repo_root / ".env")

    out_dir = args.out if args.out.is_absolute() else (repo_root / args.out)
    source_url = os.getenv("DINGTALK_SOURCE_URL", DEFAULT_SOURCE_URL)
    password = (args.password if args.password is not None else os.getenv("CALENDAR_PASSWORD", "")).strip()

    if args.require_encryption and not password:
        print("[error] 已开启 --require-encryption，但未设置 CALENDAR_PASSWORD，已中止以防明文泄露", file=sys.stderr)
        return 1

    app_key = os.getenv("DINGTALK_APP_KEY", "").strip()
    app_secret = os.getenv("DINGTALK_APP_SECRET", "").strip()
    operator_id = os.getenv("DINGTALK_OPERATOR_ID", "").strip()
    user_id = os.getenv("DINGTALK_USER_ID", "").strip()
    mobile = os.getenv("DINGTALK_MOBILE", "").strip()
    base_id = os.getenv("DINGTALK_BASE_ID", DEFAULT_BASE_ID).strip() or DEFAULT_BASE_ID
    sheet_id = os.getenv("DINGTALK_SHEET_ID", DEFAULT_SHEET_ID).strip() or DEFAULT_SHEET_ID
    pro_workbook_id = os.getenv("DINGTALK_PRO_WORKBOOK_ID", DEFAULT_PRO_WORKBOOK_ID).strip()
    grid_workbook_id = os.getenv("DINGTALK_GRID_WORKBOOK_ID", DEFAULT_GRID_WORKBOOK_ID).strip()

    use_api = args.csv is None and bool(app_key and app_secret and (operator_id or user_id or mobile))

    pro_rows: List[Dict[str, Any]] = []
    grid_rows: List[Dict[str, Any]] = []

    if use_api:
        print(f"[info] 正在连接钉钉 AI 表格 API (baseId={base_id}, sheetId={sheet_id})...")
        token = get_dingtalk_access_token(app_key, app_secret)
        if not operator_id and user_id:
            print(f"[info] 正在通过 userid({user_id}) 查询操作人 unionId...")
            operator_id = resolve_union_id_by_userid(token, user_id)
        elif not operator_id and mobile:
            print(f"[info] 正在通过手机号查询操作人 unionId...")
            operator_id = resolve_union_id_by_mobile(token, mobile)
        raw_rows = fetch_dingtalk_records(token, base_id, sheet_id, operator_id)
        source_mode = "dingtalk-api"
        print(f"[info] 成功从钉钉拉取 {len(raw_rows)} 条原始记录")
        pro_rows, grid_rows = fetch_supplementary_workbooks(
            token, operator_id, pro_workbook_id, grid_workbook_id
        )
    else:
        csv_path = args.csv if args.csv else (repo_root / "data" / "schedule.csv")
        if not csv_path.exists():
            if (out_dir / "data" / "schedule.enc.json").exists():
                print("[info] 未配置钉钉 API 且无本地 CSV，保留现有加密排期文件直接部署")
                return 0
            print(f"[error] 未配置钉钉 API 密钥，且未找到回退 CSV 文件: {csv_path}", file=sys.stderr)
            return 1
        print(f"[info] 使用 CSV 数据源生成日历: {csv_path}")
        raw_rows = load_csv_rows(csv_path)
        source_mode = "csv-fallback" if args.csv is None else "csv-manual"

    events = build_events(raw_rows)
    if pro_rows or grid_rows:
        n_pro, n_grid = merge_supplements(events, pro_rows, grid_rows)
        print(
            f"[info] 三表合并完成：从「专业课直播汇总表」补充 {n_pro} 场，"
            f"从「咨询师之家直播时间表」补充 {n_grid} 场"
        )
        if n_pro > 0 or n_grid > 0:
            source_mode = "dingtalk-3table"
    changed = write_outputs(
        events,
        out_dir,
        source_mode=source_mode,
        source_url=source_url,
        password=password,
        force=args.force,
    )

    conflicts = sum(1 for e in events if e["isConflict"])
    undated = sum(1 for e in events if not e["date"])
    target_desc = f"{out_dir / 'data' / 'schedule.enc.json'}（AES-256-GCM 加密）" if password else f"{out_dir / 'data' / 'schedule.json'} 与 {out_dir / 'calendar.ics'}"
    if changed:
        print(f"[ok] 已生成 {target_desc} | 共 {len(events)} 场直播，冲突 {conflicts} 场，缺日期 {undated} 场")
    else:
        print(f"[ok] 排期内容无变化，跳过写入（避免无效 commit）| 共 {len(events)} 场直播，冲突 {conflicts} 场，缺日期 {undated} 场")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
