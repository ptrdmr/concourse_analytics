"""Per-day role hours survive the labor pull and the employee merge."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from build_employees import merge_days  # noqa: E402
from pull_7shifts_labor import aggregate_employees_labor  # noqa: E402


class ByRoleTests(unittest.TestCase):
    def test_two_punches_split_by_role(self):
        punches = [
            {
                'user_id': 1,
                'deleted': False,
                'role_id': 10,
                'hourly_wage': 1500,
                'clocked_in': '2026-06-15T16:00:00-07:00',
                'clocked_out': '2026-06-15T20:00:00-07:00',
            },
            {
                'user_id': 1,
                'deleted': False,
                'role_id': 11,
                'hourly_wage': 1500,
                'clocked_in': '2026-06-15T20:00:00-07:00',
                'clocked_out': '2026-06-15T22:00:00-07:00',
            },
        ]
        users = [{'id': 1, 'first_name': 'Sam', 'last_name': 'Lee', 'active': True}]
        roles = {'10': 'Line', '11': 'Bartender'}
        out = aggregate_employees_labor(
            punches, users, [], roles, ZoneInfo('America/Los_Angeles'), object(),
        )
        day = out['1']['days']['2026-06-15']
        self.assertEqual(day['byRole']['Line']['hours'], 4.0)
        self.assertEqual(day['byRole']['Bartender']['hours'], 2.0)
        self.assertAlmostEqual(day['hours'], 6.0)

    def test_merge_days_keeps_a_fresh_by_role(self):
        labor = {
            '2026-06-15': {
                'hours': 6,
                'laborCost': 90,
                'byRole': {'Line': {'hours': 6, 'laborCost': 90}},
            },
        }
        merged = merge_days({'2026-06-15': {'sales': 10}}, labor)
        merged['2026-06-15']['byRole']['Line']['hours'] = 0
        self.assertEqual(labor['2026-06-15']['byRole']['Line']['hours'], 6)


if __name__ == '__main__':
    unittest.main()
