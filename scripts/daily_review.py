#!/usr/bin/env python3
"""
Build yesterday's review from public/data and send it through Gmail.

Usage:
  py -3 scripts/daily_review.py --preview
  py -3 scripts/daily_review.py --date 2026-10-07 --preview
  py -3 scripts/daily_review.py --to me@example.com
  py -3 scripts/daily_review.py --incomplete "git push failed"

Reads GMAIL_USER, GMAIL_APP_PASSWORD, DAILY_REVIEW_TO and DAILY_REVIEW_ENABLED
from .env. --preview writes HTML and Markdown and sends nothing. --to sends
even when DAILY_REVIEW_ENABLED is off, so a test can go out before the nightly
is switched on.
"""

from __future__ import annotations

import argparse
import os
import smtplib
import sys
from datetime import datetime
from email.message import EmailMessage

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, 'scripts'))

from dotenv import load_dotenv  # noqa: E402

from daily_review_data import (  # noqa: E402
    default_review_date,
    gather_review,
    load_review_config,
)
from daily_review_render import render_html, render_markdown, subject_line  # noqa: E402

load_dotenv(os.path.join(_ROOT, '.env'))

ARCHIVE_DIR = os.path.join(_ROOT, 'reports', 'daily_review')
PREVIEW_DIR = os.path.join(_ROOT, 'reports', 'preview')


def _say(line: str) -> None:
    """Print without dying on a Windows console that cannot show arrows."""
    try:
        print(line)
    except UnicodeEncodeError:
        print(line.encode('ascii', 'replace').decode('ascii'))


def _enabled() -> bool:
    return os.getenv('DAILY_REVIEW_ENABLED', '').strip().lower() in ('1', 'true', 'yes')


def _health_notes() -> list[str]:
    raw = os.getenv('DAILY_REVIEW_HEALTH', '').strip()
    if not raw:
        return []
    return [part.strip() for part in raw.split('|') if part.strip()]


def decide(metrics: dict, *, enabled: bool, preview: bool, to_override: str | None) -> str:
    """What to do with a rendered review. Preview never sends."""
    if preview:
        return 'preview'
    if metrics.get('closed') and not metrics.get('banner'):
        return 'skip-closed'
    if to_override:
        return 'send'
    if not enabled:
        return 'skip-disabled'
    return 'send'


def _banner_only(review_iso: str, reason: str) -> dict:
    return {
        'date': review_iso,
        'closed': False,
        'show_numbers': False,
        'banner': reason,
        'flags': [],
        'pos_generated_at': '',
        'labor': {'available': False, 'source': ''},
        'labor_file_source': '',
    }


def _write(directory: str, day: str, markdown_text: str, html_text: str) -> str:
    os.makedirs(directory, exist_ok=True)
    md_path = os.path.join(directory, f'{day}.md')
    html_path = os.path.join(directory, f'{day}.html')
    with open(md_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(markdown_text)
    with open(html_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html_text)
    return md_path


def send_email(subject: str, text: str, html_body: str, recipients: list[str],
               user: str, password: str) -> None:
    message = EmailMessage()
    message['From'] = user
    message['To'] = ', '.join(recipients)
    message['Subject'] = subject
    message.set_content(text)
    message.add_alternative(html_body, subtype='html')
    with smtplib.SMTP('smtp.gmail.com', 587, timeout=60) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.ehlo()
        smtp.login(user, password.replace(' ', ''))
        smtp.send_message(message)


def _recipients(to_override: str | None) -> list[str]:
    raw = to_override if to_override else os.getenv('DAILY_REVIEW_TO', '')
    return [part.strip() for part in raw.split(',') if part.strip()]


def build_metrics(args: argparse.Namespace) -> dict:
    review = datetime.strptime(args.date, '%Y-%m-%d').date() if args.date else default_review_date()
    try:
        metrics = gather_review(
            review,
            config=load_review_config(),
            health_notes=_health_notes(),
        )
    except FileNotFoundError as exc:
        if not args.incomplete:
            raise
        return _banner_only(review.isoformat(), f'{args.incomplete} ({exc})')
    if args.incomplete:
        prefix = args.incomplete.strip()
        if metrics.get('banner'):
            metrics['banner'] = f'{prefix} {metrics["banner"]}'
        else:
            metrics['banner'] = prefix
    return metrics


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Email the previous business day review.')
    parser.add_argument('--date', help='Business day YYYY-MM-DD. Default: yesterday (before 4 AM, the day before).')
    parser.add_argument('--preview', action='store_true', help='Write HTML and Markdown. Do not send.')
    parser.add_argument('--to', help='Send to this address instead of DAILY_REVIEW_TO.')
    parser.add_argument('--incomplete', help='Banner text. Numbers are included only if POS data for the day is fresh.')
    args = parser.parse_args(argv)

    try:
        metrics = build_metrics(args)
    except FileNotFoundError as exc:
        _say(f'FAIL: {exc}')
        return 1

    action = decide(
        metrics,
        enabled=_enabled(),
        preview=args.preview,
        to_override=args.to,
    )
    day = metrics['date']

    if action == 'skip-closed':
        _say(f'SKIP: closed {day}')
        return 0
    if action == 'skip-disabled':
        _say(f'SKIP: DAILY_REVIEW_ENABLED is off ({day})')
        return 0

    text = render_markdown(metrics)
    html_body = render_html(text, metrics['date'])
    subject = subject_line(metrics)
    directory = PREVIEW_DIR if action == 'preview' else ARCHIVE_DIR
    path = _write(directory, day, text, html_body)

    if action == 'preview':
        _say(f'PREVIEW: {path}')
        _say(f'SUBJECT: {subject}')
        return 0

    recipients = _recipients(args.to)
    user = os.getenv('GMAIL_USER', '').strip()
    password = os.getenv('GMAIL_APP_PASSWORD', '').strip()
    if not recipients or not user or not password:
        _say('FAIL: set GMAIL_USER, GMAIL_APP_PASSWORD and DAILY_REVIEW_TO (or pass --to)')
        return 1
    try:
        send_email(subject, text, html_body, recipients, user, password)
    except (OSError, smtplib.SMTPException) as exc:
        _say(f'FAIL: email not sent ({exc})')
        return 1
    _say(f'SENT: {day} to {", ".join(recipients)}')
    _say(f'SUBJECT: {subject}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
