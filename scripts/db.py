#!/usr/bin/env python3
"""Shared SQL Server connection helper for read-only journal pulls."""

from __future__ import annotations

import os
import time
from typing import Any

import pyodbc
from dotenv import load_dotenv

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _env_file() -> str:
    """Credentials live in .env, which is gitignored.

    A linked worktree has no .env of its own. Fall back to the checkout this
    worktree was created from (the one the nightly job runs), so a dev run
    still connects as concourse_readonly and nothing secret is copied.
    """
    local = os.path.join(_ROOT, '.env')
    if os.path.isfile(local):
        return local
    git_path = os.path.join(_ROOT, '.git')
    if not os.path.isfile(git_path):
        return local
    with open(git_path, encoding='utf-8') as handle:
        line = handle.read().strip()
    if not line.lower().startswith('gitdir:'):
        return local
    gitdir = os.path.normpath(line.split(':', 1)[1].strip())
    # gitdir: <main>/.git/worktrees/<name>  ->  main checkout is three levels up
    if os.path.basename(os.path.dirname(gitdir)) != 'worktrees':
        return local
    main_root = os.path.dirname(os.path.dirname(os.path.dirname(gitdir)))
    sibling = os.path.join(main_root, '.env')
    return sibling if os.path.isfile(sibling) else local


load_dotenv(_env_file())

PREFERRED_DRIVERS = [
    'ODBC Driver 18 for SQL Server',
    'ODBC Driver 17 for SQL Server',
    'SQL Server Native Client 11.0',
    'SQL Server',
]


def _pick_driver() -> str:
    configured = os.getenv('ODBC_DRIVER', '').strip()
    if configured:
        return configured
    installed = {d.strip() for d in pyodbc.drivers()}
    for name in PREFERRED_DRIVERS:
        if name in installed:
            return name
    if installed:
        return sorted(installed)[-1]
    raise RuntimeError(
        'No ODBC driver found. Install "ODBC Driver 18 for SQL Server" on the server.'
    )


def connection_string(database: str | None = None) -> str:
    server = os.getenv('SQL_SERVER', r'SYNCSERVER\SYNCDB')
    database = database or os.getenv('SQL_DATABASE', 'SyncJournal')
    user = os.getenv('SQL_USER', 'concourse_readonly')
    password = os.getenv('SQL_PASSWORD', '')
    if not password:
        raise RuntimeError('SQL_PASSWORD is not set. Copy .env.example to .env and fill it in.')

    driver = _pick_driver()
    parts = [
        f'DRIVER={{{driver}}}',
        f'SERVER={server}',
        f'DATABASE={database}',
        f'UID={user}',
        f'PWD={password}',
        'Encrypt=yes',
        'TrustServerCertificate=yes',
    ]
    return ';'.join(parts)


def connect(retries: int = 3, delay_sec: float = 2.0, database: str | None = None) -> pyodbc.Connection:
    """Open a read-only-intent connection with simple retries."""
    last_err: Exception | None = None
    conn_str = connection_string(database)
    for attempt in range(1, retries + 1):
        try:
            conn = pyodbc.connect(conn_str, timeout=30)
            conn.autocommit = True
            return conn
        except pyodbc.Error as exc:
            last_err = exc
            if attempt < retries:
                time.sleep(delay_sec)
    raise RuntimeError(f'Failed to connect to SQL Server after {retries} attempts: {last_err}')


def fetch_all(sql: str, params: tuple[Any, ...] | None = None) -> list[tuple]:
    with connect() as conn:
        cur = conn.cursor()
        if params:
            cur.execute(sql, params)
        else:
            cur.execute(sql)
        return cur.fetchall()
