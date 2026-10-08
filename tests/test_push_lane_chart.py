"""Shape the POS lane book without a database connection."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from push_lane_chart import shape_book  # noqa: E402


def row(**kwargs):
    base = {
        'reservation_id': 5,
        'title': 'Smith Birthday',
        'status': 2,
        'type_name': 'Kingpin',
        'resource_name': 'Lane 1',
        'start': datetime(2026, 10, 7, 19, 0),
        'end': datetime(2026, 10, 7, 21, 0),
    }
    base.update(kwargs)
    return base


class ShapeBookTests(unittest.TestCase):
    def test_one_am_moves_to_previous_date(self):
        days, _stats = shape_book([
            row(
                start=datetime(2026, 10, 8, 1, 0),
                end=datetime(2026, 10, 8, 3, 0),
                resource_name='Lane 4',
            ),
        ])
        block = days['2026-10-07'][0]
        self.assertEqual(block['startMinute'], 1020)
        self.assertEqual(block['durationMinutes'], 120)
        self.assertNotIn('2026-10-08', days)

    def test_two_lanes_one_window(self):
        days, _stats = shape_book([
            row(resource_name='Lane 2'),
            row(resource_name='Lane 1'),
        ])
        blocks = days['2026-10-07']
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]['lanes'], [1, 2])

    def test_two_windows_distinct_ids(self):
        days, _stats = shape_book([
            row(start=datetime(2026, 10, 7, 19, 0), end=datetime(2026, 10, 7, 21, 0)),
            row(start=datetime(2026, 10, 7, 12, 0), end=datetime(2026, 10, 7, 14, 0), resource_name='Lane 8'),
        ])
        ids = {block['id'] for block in days['2026-10-07']}
        self.assertEqual(len(ids), 2)

    def test_non_lane_resource_is_skipped(self):
        days, stats = shape_book([row(resource_name='Arcade')])
        self.assertEqual(days, {})
        self.assertEqual(stats['skipped_resource'], 1)
        self.assertEqual(stats['skipped_no_lanes'], 1)

    def test_hold_and_unknown_status(self):
        days, stats = shape_book([
            row(reservation_id=1, status=0),
            row(reservation_id=2, status=5, resource_name='Lane 9'),
        ])
        self.assertEqual(days['2026-10-07'][0]['status'], 'hold')
        self.assertEqual(stats['skipped_status'], {'5': 1})
        self.assertEqual(stats['hold'], 1)
        self.assertEqual(stats['firm'], 0)

    def test_end_past_8am_is_clipped(self):
        days, stats = shape_book([
            row(
                start=datetime(2026, 10, 7, 23, 0),
                end=datetime(2026, 10, 8, 9, 0),
            ),
        ])
        block = days['2026-10-07'][0]
        self.assertEqual(block['startMinute'], 900)
        self.assertEqual(block['startMinute'] + block['durationMinutes'], 1440)
        self.assertEqual(stats['clipped'], 1)

    def test_no_reservations_title_is_left_out(self):
        days, stats = shape_book([
            row(title='NO RESERVATIONS', resource_name='Lane 1'),
            row(title='NO RESERVATIONS', resource_name='Lane 2'),
            row(reservation_id=9, title='Smith Birthday', resource_name='Lane 4'),
        ])
        labels = [block['label'] for block in days['2026-10-07']]
        self.assertEqual(labels, ['Smith Birthday - Kingpin'])
        self.assertEqual(stats['skipped_title'], 1)

    def test_id_suffix_on_shared_start(self):
        days, _stats = shape_book([
            row(start=datetime(2026, 10, 7, 19, 0), end=datetime(2026, 10, 7, 20, 0), resource_name='Lane 1'),
            row(start=datetime(2026, 10, 7, 19, 0), end=datetime(2026, 10, 7, 21, 0), resource_name='Lane 3'),
        ])
        ids = sorted(block['id'] for block in days['2026-10-07'])
        self.assertEqual(ids, ['pos:5:202610071900', 'pos:5:202610071900-2100'])


if __name__ == '__main__':
    unittest.main()
