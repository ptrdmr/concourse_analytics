#!/usr/bin/env python3
"""
Build a completed week, month, quarter, or year review and send it through Gmail.

Usage:
  py -3 scripts/period_review.py --period month --as-of 2026-09-30 --preview
  py -3 scripts/period_review.py --due
  py -3 scripts/period_review.py --period week --to me@example.com

Reads GMAIL_USER, GMAIL_APP_PASSWORD, PERIOD_REVIEW_TO (or DAILY_REVIEW_TO),
PERIOD_REVIEW_ENABLED and optional DASHBOARD_URL from .env. --preview writes
HTML and Markdown and sends nothing. --to sends even when the switch is off.
--due sends each period that just ended and has not been sent yet.
"""

from __future__ import annotations

import argparse
import json
import os
import smtplib
import sys
from datetime import datetime

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, 'scripts'))

from dotenv import load_dotenv  # noqa: E402

from daily_review import _say, send_email  # noqa: E402
from daily_review_data import default_review_date, load_review_config  # noqa: E402
from period_review_data import (  # noqa: E402
    due_periods,
    gather_period,
    load_context,
    period_bounds,
)
from period_review_render import render_markdown, render_period_html, subject_line  # noqa: E402

load_dotenv(os.path.join(_ROOT, '.env'))

ARCHIVE_DIR = os.path.join(_ROOT, 'reports', 'period_review')
PREVIEW_DIR = os.path.join(_ROOT, 'reports', 'preview')
SENT_PATH = os.path.join(ARCHIVE_DIR, 'sent.json')


def _enabled() -> bool:
    return os.getenv('PERIOD_REVIEW_ENABLED', '').strip().lower() in ('1', 'true', 'yes')


def _recipients(to_override: str | None) -> list[str]:
    raw = to_override if to_override else (
        os.getenv('PERIOD_REVIEW_TO', '') or os.getenv('DAILY_REVIEW_TO', '')
    )
    return [part.strip() for part in raw.split(',') if part.strip()]


def load_sent(path: str | None = None) -> dict:
    target = path or SENT_PATH
    if not os.path.isfile(target):
        return {}
    with open(target, encoding='utf-8') as handle:
        payload = json.load(handle)
    return payload if isinstance(payload, dict) else {}


def save_sent(sent: dict, path: str | None = None) -> None:
    target = path or SENT_PATH
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(sent, handle, indent=2)
        handle.write('\n')


def _write(directory: str, label: str, markdown_text: str, html_text: str) -> str:
    os.makedirs(directory, exist_ok=True)
    md_path = os.path.join(directory, f'{label}.md')
    html_path = os.path.join(directory, f'{label}.html')
    with open(md_path, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(markdown_text)
    with open(html_path, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(html_text)
    return md_path


def deliver(metrics: dict, *, preview: bool, to_override: str | None, record: bool) -> str:
    """Write the review and maybe send it. Returns preview, send, skip-closed, or skip-disabled."""
    if metrics.get('closed') and not metrics.get('banner'):
        return 'skip-closed'
    if not preview and not to_override and not _enabled():
        return 'skip-disabled'
    text = render_markdown(metrics)
    html_body = render_period_html(metrics, text)
    subject = subject_line(metrics)
    label = metrics['label']
    if preview:
        path = _write(PREVIEW_DIR, label, text, html_body)
        _say(f'PREVIEW: {path}')
        _say(f'SUBJECT: {subject}')
        return 'preview'
    directory = os.path.join(ARCHIVE_DIR, metrics['kind'])
    path = _write(directory, label, text, html_body)
    recipients = _recipients(to_override)
    user = os.getenv('GMAIL_USER', '').strip()
    password = os.getenv('GMAIL_APP_PASSWORD', '').strip()
    if not recipients or not user or not password:
        raise RuntimeError('set GMAIL_USER, GMAIL_APP_PASSWORD and PERIOD_REVIEW_TO (or pass --to)')
    send_email(subject, text, html_body, recipients, user, password)
    if record:
        sent = load_sent()
        sent[metrics['kind']] = label
        save_sent(sent)
    _say(f'SENT: {metrics["kind"]} {label} to {", ".join(recipients)}')
    _say(f'SUBJECT: {subject}')
    _say(f'ARCHIVE: {path}')
    return 'send'


def _prepare(metrics: dict) -> dict:
    metrics['dashboard_url'] = os.getenv('DASHBOARD_URL', '').strip()
    return metrics


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Email a completed week, month, quarter, or year.')
    parser.add_argument('--period', choices=('week', 'month', 'quarter', 'year'))
    parser.add_argument('--as-of', help='Review date YYYY-MM-DD. Default: the daily review date.')
    parser.add_argument('--preview', action='store_true', help='Write HTML and Markdown. Do not send.')
    parser.add_argument('--to', help='Send to this address instead of PERIOD_REVIEW_TO.')
    parser.add_argument('--due', action='store_true', help='Send each period that just ended and is not on file yet.')
    args = parser.parse_args(argv)
    if args.due == bool(args.period):
        parser.error('Pass either --due or --period')

    as_of = datetime.strptime(args.as_of, '%Y-%m-%d').date() if args.as_of else default_review_date()
    try:
        context = load_context(config=load_review_config())
    except FileNotFoundError as exc:
        _say(f'FAIL: {exc}')
        return 1

    if args.due:
        periods = due_periods(as_of, load_sent(), context['summary'])
        if not periods:
            _say(f'SKIP: nothing due as of {as_of.isoformat()}')
            return 0
    else:
        start, end, _label = period_bounds(args.period, as_of)
        periods = [(args.period, start, end, _label)]

    failed = False
    for kind, start, end, label in periods:
        try:
            metrics = _prepare(gather_period(kind, start, end, context=context))
        except FileNotFoundError as exc:
            _say(f'FAIL: {kind} {label} ({exc})')
            failed = True
            continue
        try:
            action = deliver(
                metrics,
                preview=args.preview,
                to_override=args.to,
                record=args.due and not args.preview and not args.to,
            )
        except (OSError, RuntimeError, smtplib.SMTPException) as exc:
            _say(f'FAIL: {kind} {label} not sent ({exc})')
            failed = True
            continue
        if action == 'skip-closed':
            _say(f'SKIP: closed {kind} {label}')
        elif action == 'skip-disabled':
            _say(f'SKIP: PERIOD_REVIEW_ENABLED is off ({kind} {label})')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
