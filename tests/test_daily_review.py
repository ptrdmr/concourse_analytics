"""Daily review metrics, flags, and the send-or-skip decision."""

from __future__ import annotations

import json
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from daily_review import decide  # noqa: E402
from daily_review_data import gather_review  # noqa: E402
from daily_review_render import render_html, render_markdown, subject_line  # noqa: E402

REVIEW = date(2026, 6, 15)
LY_DOW = REVIEW - timedelta(days=364)
LY_DATE = date(2025, 6, 15)


def _config():
    return {
        'departmentGroups': [
            {'id': 'food', 'label': 'Food', 'departments': ['Food']},
            {'id': 'bar', 'label': 'Bar', 'departments': ['Bar']},
            {'id': 'bowling', 'label': 'Bowling', 'departments': ['Bowling']},
            {'id': 'parties', 'label': 'Parties', 'departments': ['Parties']},
            {'id': 'leagues', 'label': 'Leagues', 'departments': ['League Fees']},
            {'id': 'other', 'label': 'Other', 'departments': ['Arcade']},
        ],
        'prizeFundDepartment': 'League Prize Fund',
        'dropFlagGroups': ['food', 'bar', 'bowling'],
        'bowling': {
            'gamesSubdepartments': ['Game Bowling'],
            'laneHoursSubdepartments': ['Time Bowling'],
            'laneHoursDivisor': 60,
            'shoesSubdepartments': ['Rental Shoes'],
            'onlineSubdepartments': ['Online Lane Reservations'],
        },
        'partyTypes': ['Kingpin Suite'],
        'roleOrder': ['Line', 'Bartender'],
        'thresholds': {
            'deptDropPct': 40,
            'deptDropMinLyDollars': 200,
            'refundsDollars': 470,
            'tipPctLow': 3,
            'tipPctHigh': 10,
            'noHoursMinSales': 25,
            'laborPctHigh': 35,
        },
    }


def _row(day, name, dept, revenue, qty=1, sub=''):
    return {
        'date': day.isoformat(),
        'name': name,
        'department': dept,
        'subdepartment': sub,
        'category': dept,
        'quantity': qty,
        'revenue': revenue,
        'transactions': 1,
    }


def _write(directory: Path, name: str, payload) -> None:
    path = directory / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding='utf-8')


def _fixture(directory: Path, *, generated='2026-06-16T05:31:00', labor_generated='2026-06-16T05:40:00',
             rows=None, labor_source='report', employees=None, tips=80.0,
             labor_cost=200.0, labor_hours=10.0) -> None:
    _write(directory, 'summary.json', {
        'generatedAt': generated,
        'dateRange': ['2023-01-01', '2026-06-15'],
        'nonRevenue': {'departments': {'League Prize Fund': 'Held for league prize funds'}},
    })
    _write(directory, 'transactions.json', rows if rows is not None else [])
    _write(directory, 'labor.json', {
        'generatedAt': labor_generated,
        'source': labor_source,
        'days': {
            REVIEW.isoformat(): {'laborCost': labor_cost, 'laborHours': labor_hours, 'source': labor_source},
            LY_DOW.isoformat(): {'laborCost': 180.0, 'laborHours': 9.0, 'source': 'report'},
        },
    })
    _write(directory, 'gratuity.json', {
        'dates': {
            REVIEW.isoformat(): {'pre17': {'Bar': {'Sam': tips}}, 'post17': {}},
        },
    })
    _write(directory, 'reservation_counts.json', {
        'rows': [{'date': REVIEW.isoformat(), 'type': 'Kingpin Suite', 'count': 2}],
    })
    _write(directory, 'employees.json', {'employees': employees or []})


def _busy_rows():
    recent = REVIEW - timedelta(days=2)
    return [
        _row(REVIEW, 'Burger', 'Food', 400),
        _row(LY_DOW, 'Burger', 'Food', 1000),
        _row(LY_DATE, 'Burger', 'Food', 700),
        _row(REVIEW, 'Draft', 'Bar', 800),
        _row(REVIEW, '[Adjustments & Refunds]', 'Bar', -500, qty=0),
        _row(LY_DOW, 'Draft', 'Bar', 800),
        _row(REVIEW, 'Game Bowling', 'Bowling', 300, qty=40, sub='Game Bowling'),
        _row(REVIEW, 'Time Bowling', 'Bowling', 120, qty=120, sub='Time Bowling'),
        _row(REVIEW, 'Prize', 'League Prize Fund', 90),
        _row(REVIEW - timedelta(days=1), 'Burger', 'Food', 100),
    ], recent


class GatherTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def test_net_sales_excludes_prize_fund_and_counts_deductions(self):
        rows, recent = _busy_rows()
        _fixture(self.data, rows=rows, tips=200.0, employees=[{
            'displayName': 'Sam',
            'roles': ['Line'],
            'days': {
                REVIEW.isoformat(): {'sales': 40, 'hours': 0},
                recent.isoformat(): {'sales': 10, 'hours': 5},
            },
        }])
        metrics = gather_review(REVIEW, str(self.data), _config())
        # Food 400 + Bar 800 - 500 + Bowling 300 + 120. Prize fund stays out.
        self.assertAlmostEqual(metrics['net_sales'], 1120.0)
        self.assertAlmostEqual(metrics['prize_fund'], 90.0)
        self.assertEqual(metrics['ly_dow'], LY_DOW.isoformat())
        self.assertNotIn('ly_date', metrics)
        self.assertAlmostEqual(metrics['net_sales_ly_dow'], 1800.0)
        self.assertNotIn('net_sales_ly_date', metrics)
        self.assertAlmostEqual(metrics['bowling']['games'], 40.0)
        self.assertAlmostEqual(metrics['bowling']['lane_hours'], 2.0)
        self.assertEqual(metrics['parties']['count'], 2)
        self.assertEqual(metrics['running']['wtd']['days'], REVIEW.weekday() + 1)
        titles = [flag['title'] for flag in metrics['flags']]
        self.assertTrue(any(title.startswith('Food down') for title in titles))
        self.assertTrue(any(title.startswith('Bar down') for title in titles))
        self.assertTrue(any(title.startswith('Adjustments and refunds') for title in titles))
        self.assertTrue(any('no hours' in title for title in titles))
        self.assertTrue(any(title.startswith('Tip %') for title in titles))
        self.assertFalse(any(title.startswith('Leagues') for title in titles))
        text = render_markdown(metrics)
        self.assertIn('Needs Attention', text)
        self.assertNotIn('All clear.', text)
        self.assertTrue(subject_line(metrics).startswith('['))
        self.assertIn('## By Department', text)
        self.assertIn('## Details', text)
        self.assertNotIn('## Departments', text)
        self.assertNotIn('same date', text.lower())
        html_body = render_html(text, metrics['date'])
        self.assertIn('Concourse Bowling Daily Sales', html_body)
        self.assertIn('#ff1d25', html_body)
        self.assertIn('color-scheme', html_body)
        self.assertIn('Details', html_body)
        self.assertNotIn('same date', html_body.lower())
        self.assertIn('Concourse Bowling Daily Sales', subject_line(metrics))
        self.assertIn('color:#ff1d25', html_body)

    def test_each_flag_can_stay_off(self):
        rows = [
            _row(REVIEW, 'Burger', 'Food', 500),
            _row(LY_DOW, 'Burger', 'Food', 480),
            _row(REVIEW, 'Draft', 'Bar', 500),
            _row(LY_DOW, 'Draft', 'Bar', 500),
            _row(REVIEW, 'Game', 'Bowling', 400, sub='Game Bowling'),
            _row(LY_DOW, 'Game', 'Bowling', 400, sub='Game Bowling'),
        ]
        _fixture(self.data, rows=rows, tips=80.0, employees=[{
            'displayName': 'Sam',
            'roles': ['Bartender'],
            'days': {REVIEW.isoformat(): {'sales': 100, 'hours': 6, 'laborCost': 90}},
        }])
        metrics = gather_review(REVIEW, str(self.data), _config())
        self.assertEqual(metrics['flags'], [])
        self.assertIn('All clear.', render_markdown(metrics))
        self.assertNotIn('[', subject_line(metrics).split(':')[0])

    def test_owner_who_never_clocks_in_is_not_flagged(self):
        rows = [_row(REVIEW, 'Burger', 'Food', 500), _row(LY_DOW, 'Burger', 'Food', 500)]
        _fixture(self.data, rows=rows, tips=30.0, employees=[{
            'displayName': 'Owner',
            'roles': [],
            'days': {REVIEW.isoformat(): {'sales': 80, 'hours': 0}},
        }])
        metrics = gather_review(REVIEW, str(self.data), _config())
        self.assertFalse(any('no hours' in flag['title'] for flag in metrics['flags']))

    def test_closed_day(self):
        _fixture(self.data, rows=[])
        metrics = gather_review(REVIEW, str(self.data), _config())
        self.assertTrue(metrics['closed'])
        self.assertFalse(metrics['show_numbers'])
        self.assertEqual(decide(metrics, enabled=True, preview=False, to_override=None), 'skip-closed')

    def test_stale_pos_hides_numbers(self):
        _fixture(self.data, generated='2026-06-15T05:31:00', rows=[_row(REVIEW, 'Burger', 'Food', 500)])
        metrics = gather_review(REVIEW, str(self.data), _config())
        self.assertFalse(metrics['show_numbers'])
        self.assertIn('not ready', metrics['banner'])
        text = render_markdown(metrics)
        self.assertIn('Data incomplete', text)
        self.assertNotIn('Net Sales', text)
        self.assertIn('data incomplete', subject_line(metrics))

    def test_stale_labor_keeps_sales_and_flags(self):
        rows = [_row(REVIEW, 'Burger', 'Food', 500), _row(LY_DOW, 'Burger', 'Food', 500)]
        _fixture(self.data, rows=rows, tips=30.0, labor_generated='2026-06-15T05:40:00')
        metrics = gather_review(REVIEW, str(self.data), _config())
        self.assertTrue(metrics['show_numbers'])
        self.assertFalse(metrics['labor']['available'])
        self.assertTrue(any(flag['title'] == 'Labor unavailable' for flag in metrics['flags']))
        self.assertIn('unavailable', render_markdown(metrics))

    def test_estimated_labor_is_a_flag(self):
        rows = [_row(REVIEW, 'Burger', 'Food', 500), _row(LY_DOW, 'Burger', 'Food', 500)]
        _fixture(self.data, rows=rows, tips=30.0, labor_source='punches_estimated')
        metrics = gather_review(REVIEW, str(self.data), _config())
        self.assertTrue(metrics['labor']['available'])
        self.assertTrue(any('estimated' in flag['title'] for flag in metrics['flags']))

    def test_high_labor_flags(self):
        rows = [_row(REVIEW, 'Burger', 'Food', 1000), _row(LY_DOW, 'Burger', 'Food', 1000)]
        _fixture(self.data, rows=rows, tips=60.0, labor_cost=500.0, labor_hours=20.0)
        metrics = gather_review(REVIEW, str(self.data), _config())
        self.assertTrue(any(flag['title'].startswith('Labor ') for flag in metrics['flags']))
        self.assertIn('threshold 35%', metrics['flags'][0]['detail'])

    def test_by_role_hours_split_the_day(self):
        rows = [_row(REVIEW, 'Burger', 'Food', 500), _row(LY_DOW, 'Burger', 'Food', 500)]
        _fixture(self.data, rows=rows, tips=30.0, employees=[{
            'displayName': 'Sam',
            'roles': ['Line', 'Bartender'],
            'days': {
                REVIEW.isoformat(): {
                    'sales': 100,
                    'hours': 6,
                    'laborCost': 90,
                    'byRole': {
                        'Line': {'hours': 4, 'laborCost': 60},
                        'Bartender': {'hours': 2, 'laborCost': 30},
                    },
                },
            },
        }])
        metrics = gather_review(REVIEW, str(self.data), _config())
        self.assertEqual([row['name'] for row in metrics['roles']], ['Line', 'Bartender'])

    def test_missing_by_role_falls_back(self):
        rows = [_row(REVIEW, 'Burger', 'Food', 500), _row(LY_DOW, 'Burger', 'Food', 500)]
        _fixture(self.data, rows=rows, tips=30.0, employees=[{
            'displayName': 'Sam',
            'roles': ['Line', 'Bartender'],
            'days': {REVIEW.isoformat(): {'sales': 100, 'hours': 6, 'laborCost': 90}},
        }])
        metrics = gather_review(REVIEW, str(self.data), _config())
        self.assertEqual([row['name'] for row in metrics['roles']], ['Multiple roles'])

    def test_decide(self):
        closed = {'closed': True, 'banner': None}
        open_day = {'closed': False, 'banner': None, 'show_numbers': True}
        self.assertEqual(decide(open_day, enabled=True, preview=True, to_override=None), 'preview')
        self.assertEqual(decide(open_day, enabled=False, preview=False, to_override=None), 'skip-disabled')
        self.assertEqual(decide(open_day, enabled=False, preview=False, to_override='a@b.c'), 'send')
        self.assertEqual(decide(open_day, enabled=True, preview=False, to_override=None), 'send')
        self.assertEqual(decide(closed, enabled=True, preview=False, to_override=None), 'skip-closed')
        failed = {'closed': True, 'banner': 'git push failed'}
        self.assertEqual(decide(failed, enabled=True, preview=False, to_override=None), 'send')


if __name__ == '__main__':
    unittest.main()
