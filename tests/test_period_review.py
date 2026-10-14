"""Period bounds, last-year mapping, flags, synopsis rules, and the email caps."""

from __future__ import annotations

import json
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from daily_review_render import render_html  # noqa: E402
from period_review_data import (  # noqa: E402
    data_covers,
    due_periods,
    gather_period,
    ly_bounds,
    period_bounds,
)
from period_review_render import render_markdown  # noqa: E402
from period_review_synopsis import build_synopsis, slow_decline_flags  # noqa: E402

WEEK_START = date(2026, 6, 29)
WEEK_END = date(2026, 7, 5)


def _config():
    return {
        'departmentGroups': [
            {'id': 'food', 'label': 'Cafe', 'departments': ['Food']},
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
        'roleOrder': ['Line'],
        'thresholds': {},
        'periodThresholds': {
            'week': {
                'deptDropPct': 20, 'deptDropMinLyDollars': 100, 'refundsDollars': 50,
                'tipPctLow': 3, 'tipPctHigh': 10, 'laborPctHigh': 35,
            },
            'month': {
                'deptDropPct': 12, 'deptDropMinLyDollars': 100, 'refundsDollars': 50,
                'tipPctLow': 3, 'tipPctHigh': 10, 'laborPctHigh': 33,
            },
            'quarter': {
                'deptDropPct': 10, 'deptDropMinLyDollars': 100, 'refundsDollars': 50,
                'tipPctLow': 3, 'tipPctHigh': 10, 'laborPctHigh': 32,
            },
            'year': {
                'deptDropPct': 5, 'deptDropMinLyDollars': 100, 'refundsDollars': 50,
                'tipPctLow': 3, 'tipPctHigh': 10, 'laborPctHigh': 32,
            },
        },
    }


def _base(**overrides):
    metrics = {
        'kind': 'month',
        'label': '2026-09',
        'title': 'September 2026',
        'ly_phrase': 'last September',
        'start': '2026-09-01',
        'end': '2026-09-30',
        'show_numbers': True,
        'net_sales': 80000,
        'net_sales_ly': 80000,
        'delta_pct': 0.0,
        'departments': [],
        'labor': {
            'available': True, 'pct': 30, 'splh': 100,
            'days_with_labor': 30, 'days': 30, 'source': 'report', 'reliable': True,
        },
        'bowling': {
            'games': 100, 'games_ly': 100, 'lane_hours': 10, 'lane_hours_ly': 10,
            'online': 5, 'online_ly': 5,
        },
        'parties': {'count': 10, 'count_ly': 10, 'top': []},
        'prize_fund': 0,
        'daily': [],
        'daily_ly': [],
        'closed_days': 0,
        'closed_days_ly': 0,
        'holidays': [],
        'holidays_ly': [],
        'history': [],
        'flags': [],
        'months': [],
        'ytd': None,
        'best_day': None,
        'slowest_day': None,
        'year_best_day': None,
    }
    metrics.update(overrides)
    return metrics


def _entry(label, start, delta, sales=1000, **extra):
    row = {
        'label': label,
        'start': start,
        'end': start,
        'title': label,
        'sales': sales,
        'sales_ly': 1000,
        'delta_pct': delta,
        'groups': {},
        'labor_pct': 30,
    }
    row.update(extra)
    return row


def _text(metrics):
    return ' '.join(build_synopsis(metrics))


class BoundsTests(unittest.TestCase):
    def test_monday_uses_the_week_that_just_ended(self):
        start, end, _label = period_bounds('week', date(2026, 10, 12))
        self.assertEqual((start, end), (date(2026, 10, 5), date(2026, 10, 11)))

    def test_sunday_keeps_the_week_that_ends_that_day(self):
        start, end, _label = period_bounds('week', date(2026, 10, 11))
        self.assertEqual((start, end), (date(2026, 10, 5), date(2026, 10, 11)))

    def test_leap_day_month_and_its_last_year(self):
        start, end, label = period_bounds('month', date(2024, 2, 29))
        self.assertEqual((start, end, label), (date(2024, 2, 1), date(2024, 2, 29), '2024-02'))
        self.assertEqual(ly_bounds('month', start, end), (date(2023, 2, 1), date(2023, 2, 28)))
        self.assertEqual(
            period_bounds('month', date(2024, 3, 1))[:2],
            (date(2024, 2, 1), date(2024, 2, 29)),
        )

    def test_quarter_edges_and_new_year(self):
        self.assertEqual(period_bounds('quarter', date(2026, 3, 31))[2], '2026-Q1')
        self.assertEqual(period_bounds('quarter', date(2026, 4, 1))[2], '2026-Q1')
        self.assertEqual(period_bounds('quarter', date(2026, 6, 30))[2], '2026-Q2')
        self.assertEqual(
            period_bounds('year', date(2026, 1, 1)),
            (date(2025, 1, 1), date(2025, 12, 31), '2025'),
        )
        self.assertEqual(period_bounds('month', date(2026, 1, 1))[2], '2025-12')
        self.assertEqual(period_bounds('quarter', date(2026, 1, 1))[2], '2025-Q4')
        self.assertEqual(period_bounds('year', date(2025, 12, 31))[2], '2025')

    def test_iso_week_53_falls_back_when_last_year_has_no_week_53(self):
        start = date.fromisocalendar(2020, 53, 1)
        end = start + timedelta(days=6)
        ly_start, ly_end = ly_bounds('week', start, end)
        self.assertEqual(ly_start, date.fromisocalendar(2019, 52, 1))
        self.assertEqual(ly_end, ly_start + timedelta(days=6))


class DueTests(unittest.TestCase):
    def _summary(self, generated='2026-10-14T05:30:00', last='2026-10-13'):
        return {'generatedAt': generated, 'dateRange': ['2023-01-01', last]}

    def test_mid_october_sends_the_week_only(self):
        kinds = [item[0] for item in due_periods(date(2026, 10, 13), {}, self._summary())]
        self.assertEqual(kinds, ['week'])

    def test_catch_up_includes_a_month_that_ended_within_seven_days(self):
        kinds = [item[0] for item in due_periods(date(2026, 10, 7), {}, self._summary(last='2026-10-07', generated='2026-10-08T05:30:00'))]
        self.assertIn('month', kinds)
        later = [item[0] for item in due_periods(date(2026, 10, 8), {}, self._summary(last='2026-10-08', generated='2026-10-09T05:30:00'))]
        self.assertNotIn('month', later)

    def test_already_sent_and_stale_data_are_skipped(self):
        sent = {'week': period_bounds('week', date(2026, 10, 13))[2]}
        self.assertEqual(due_periods(date(2026, 10, 13), sent, self._summary()), [])
        stale = self._summary(generated='2026-10-01T05:30:00')
        self.assertFalse(data_covers(stale, date(2026, 10, 11)))
        self.assertEqual(due_periods(date(2026, 10, 13), {}, stale), [])

    def test_new_year_morning_is_due_for_every_period(self):
        summary = self._summary(generated='2026-01-02T05:30:00', last='2026-01-01')
        kinds = [item[0] for item in due_periods(date(2026, 1, 1), {}, summary)]
        self.assertEqual(kinds, ['week', 'month', 'quarter', 'year'])


class SynopsisTests(unittest.TestCase):
    def test_quiet_month_says_so(self):
        self.assertIn('steady month', _text(_base()))

    def test_driver_names_the_department_that_moved_the_total(self):
        text = _text(_base(
            net_sales=20000, net_sales_ly=14000, delta_pct=42.9,
            departments=[{'id': 'bowling', 'label': 'Bowling', 'sales': 10000, 'ly': 5000}],
        ))
        self.assertIn('Bowling did most of the lifting', text)

    def test_calendar_saturday_gap(self):
        daily = [{'weekday_index': 5, 'sales': 3000, 'closed': False} for _ in range(5)]
        daily_ly = [{'weekday_index': 5, 'sales': 3000, 'closed': False} for _ in range(4)]
        text = _text(_base(net_sales=20000, net_sales_ly=18000, delta_pct=11, daily=daily, daily_ly=daily_ly))
        self.assertIn('five Saturdays', text)
        self.assertIn('four', text)

    def test_holiday_and_closed_days(self):
        text = _text(_base(holidays=['Labor Day'], holidays_ly=[], closed_days=2, closed_days_ly=0))
        self.assertIn('Labor Day', text)
        self.assertIn('Two closed days', text)

    def test_shape_and_peak_month(self):
        daily = [{'sales': 100, 'closed': False} for _ in range(10)]
        daily += [{'sales': 50, 'closed': False} for _ in range(10)]
        self.assertIn('softer finish', _text(_base(daily=daily)))
        months = [
            {'label': 'Jul 2026', 'sales': 100},
            {'label': 'Aug 2026', 'sales': 200},
            {'label': 'Sep 2026', 'sales': 100},
        ]
        self.assertIn('Aug was the peak month', _text(_base(kind='quarter', months=months)))

    def test_best_day_bowling_parties_and_leagues(self):
        daily = [{'sales': 100, 'closed': False, 'date': f'2026-09-{day:02d}', 'weekday': 'Monday'} for day in range(1, 9)]
        best = {'date': '2026-09-12', 'weekday': 'Saturday', 'sales': 900, 'holiday': None}
        self.assertIn('Busiest day', _text(_base(daily=daily, best_day=best)))
        self.assertIn('Games were up', _text(_base(bowling={
            'games': 120, 'games_ly': 100, 'lane_hours': 10, 'lane_hours_ly': 10,
            'online': 5, 'online_ly': 5,
        })))
        self.assertIn('20 party bookings', _text(_base(parties={
            'count': 20, 'count_ly': 10, 'top': [{'name': 'Kingpin Suite', 'count': 9}],
        })))
        self.assertIn('League season is underway', _text(_base(departments=[{
            'id': 'leagues', 'label': 'Leagues', 'sales': 2000, 'ly': 100, 'delta_pct': 1900,
        }], prize_fund=400)))

    def test_mix_movers_and_pacing(self):
        self.assertIn('24% of sales', _text(_base(departments=[{
            'id': 'bar', 'label': 'Bar', 'share': 24, 'share_ly': 21, 'sales': 1, 'ly': 1,
        }])))
        self.assertIn('New in the top sellers: Nachos', _text(_base(departments=[{
            'id': 'food', 'label': 'Cafe',
            'top_items': [{'name': 'Nachos'}],
            'ly_top_items': [{'name': 'Wings'}],
        }])))
        self.assertIn('Year to date', _text(_base(
            kind='quarter', ytd={'sales': 250000, 'sales_ly': 230000, 'delta_pct': 8.7},
        )))

    def test_streak_reversal_momentum_and_week_minimum(self):
        down = [
            _entry('2026-08', '2026-08-01', -4),
            _entry('2026-09', '2026-09-01', -5),
        ]
        self.assertIn('Second month in a row down', _text(_base(delta_pct=-5, history=down)))
        weeks = [
            _entry('2026-W40', '2026-09-28', -4),
            _entry('2026-W41', '2026-10-05', -5),
        ]
        self.assertNotIn('in a row', _text(_base(kind='week', label='2026-W41', delta_pct=-5, history=weeks)))
        reversal = [
            _entry('2026-06', '2026-06-01', -5),
            _entry('2026-07', '2026-07-01', -5),
            _entry('2026-08', '2026-08-01', -6),
            _entry('2026-09', '2026-09-01', 4),
        ]
        self.assertIn('after three down', _text(_base(delta_pct=4, history=reversal)))
        momentum = [
            _entry('2026-07', '2026-07-01', 9),
            _entry('2026-08', '2026-08-01', 6),
            _entry('2026-09', '2026-09-01', 2),
        ]
        self.assertIn('slowing', _text(_base(delta_pct=2, history=momentum)))

    def test_record_rolling_labor_weekday_item_and_biggest_day(self):
        history = [
            _entry('2024-09', '2024-09-01', 1, sales=100),
            _entry('2025-08', '2025-08-01', 1, sales=150),
            _entry('2025-09', '2025-09-01', 1, sales=120),
            _entry('2026-09', '2026-09-01', 4, sales=400),
        ]
        self.assertIn('in our data (since 2023)', _text(_base(delta_pct=4, history=history)))
        rolling = [
            _entry('2026-07', '2026-07-01', -1, sales=100, sales_ly=90),
            _entry('2026-08', '2026-08-01', 8, sales=130, sales_ly=100),
            _entry('2026-09', '2026-09-01', -4, sales=96, sales_ly=100),
        ]
        text = _text(_base(delta_pct=-4, net_sales=96, net_sales_ly=100, history=rolling))
        self.assertIn('last three months together', text)
        creep = [
            _entry('2026-07', '2026-07-01', 1, labor_pct=27),
            _entry('2026-08', '2026-08-01', 1, labor_pct=28.4),
            _entry('2026-09', '2026-09-01', 1, labor_pct=31),
        ]
        self.assertIn('Labor has risen', _text(_base(history=creep)))
        daily = []
        daily_ly = []
        for day in range(1, 5):
            daily.append({'weekday_index': 1, 'weekday': 'Tuesday', 'sales': 100, 'closed': False, 'date': f'2026-09-0{day}'})
            daily_ly.append({'weekday_index': 1, 'weekday': 'Tuesday', 'sales': 400, 'closed': False, 'date': f'2025-09-0{day}'})
        self.assertIn('Tuesdays were down in 4 of 4 weeks', _text(_base(daily=daily, daily_ly=daily_ly)))
        trend = []
        for label, start, revenue in (
            ('2026-07', '2026-07-01', 300),
            ('2026-08', '2026-08-01', 250),
            ('2026-09', '2026-09-01', 200),
        ):
            trend.append(_entry(label, start, None, groups={
                'food': {'label': 'Cafe', 'top': [{'name': 'Nachos', 'revenue': revenue}]},
            }))
        self.assertIn('Nachos has been down for three months', _text(_base(history=trend)))
        best = {'date': '2026-09-12', 'weekday': 'Saturday', 'sales': 9000}
        self.assertIn('biggest day of 2026', _text(_base(best_day=best, year_best_day=dict(best))))

    def test_synopsis_never_exceeds_five_sentences(self):
        daily = [{'weekday_index': 5, 'sales': 3000, 'closed': False} for _ in range(5)]
        daily += [{'sales': 100, 'closed': False} for _ in range(15)]
        daily += [{'sales': 40, 'closed': False} for _ in range(10)]
        history = [
            _entry('2026-07', '2026-07-01', -8, labor_pct=27),
            _entry('2026-08', '2026-08-01', -6, labor_pct=29),
            _entry('2026-09', '2026-09-01', -4, labor_pct=32),
        ]
        sentences = build_synopsis(_base(
            delta_pct=-4, net_sales=70000, net_sales_ly=80000,
            daily=daily, holidays=['Labor Day'], closed_days=2,
            history=history,
            departments=[{'id': 'bar', 'label': 'Bar', 'share': 24, 'share_ly': 20, 'sales': 1, 'ly': 1}],
        ))
        self.assertLessEqual(len(sentences), 5)
        self.assertTrue(sentences[0].startswith('September 2026 came in at'))

    def test_slow_decline_flag_skips_a_period_that_already_tripped_the_line(self):
        history = [
            _entry('2026-07', '2026-07-01', 0, groups={'food': {'label': 'Cafe', 'delta_pct': -4}}),
            _entry('2026-08', '2026-08-01', 0, groups={'food': {'label': 'Cafe', 'delta_pct': -4}}),
            _entry('2026-09', '2026-09-01', 0, groups={'food': {'label': 'Cafe', 'delta_pct': -4}}),
        ]
        metrics = _base(history=history)
        flags = slow_decline_flags(metrics, _config())
        self.assertEqual(len(flags), 1)
        self.assertIn('Cafe', flags[0]['title'])
        metrics['flags'] = [{'group': 'food', 'title': 'Cafe down 20% vs last year'}]
        self.assertEqual(slow_decline_flags(metrics, _config()), [])


class GatherTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def _write(self, name, payload):
        path = self.data / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding='utf-8')

    def _row(self, day, name, dept, revenue, qty=1, sub=''):
        return {
            'date': day.isoformat(), 'name': name, 'department': dept, 'subdepartment': sub,
            'category': dept, 'quantity': qty, 'revenue': revenue, 'transactions': 1,
        }

    def test_week_sums_labor_coverage_and_refunds_across_months(self):
        ly_start, _ly_end = ly_bounds('week', WEEK_START, WEEK_END)
        rows = [
            self._row(WEEK_START, 'Burger', 'Food', 100),
            self._row(ly_start, 'Burger', 'Food', 1000),
            self._row(WEEK_START, 'Draft', 'Bar', 50),
            self._row(WEEK_START, '[Adjustments & Refunds]', 'Bar', -30),
            self._row(WEEK_START, 'Game', 'Bowling', 80, qty=40, sub='Game Bowling'),
            self._row(WEEK_START, 'Prize', 'League Prize Fund', 15),
        ]
        self._write('summary.json', {
            'generatedAt': '2026-07-06T05:31:00',
            'dateRange': ['2023-01-01', '2026-07-05'],
            'nonRevenue': {'departments': {'League Prize Fund': 'Held'}},
        })
        self._write('transactions.json', rows)
        self._write('labor.json', {
            'generatedAt': '2026-07-06T05:40:00',
            'source': 'report',
            'days': {
                WEEK_START.isoformat(): {'laborCost': 400, 'laborHours': 10, 'source': 'report'},
                (WEEK_START + timedelta(days=1)).isoformat(): {'laborCost': 100, 'laborHours': 4, 'source': 'report'},
            },
        })
        self._write('gratuity.json', {'dates': {WEEK_START.isoformat(): {'pre17': {'Bar': {'Sam': 10}}, 'post17': {}}}})
        self._write('reservation_counts.json', {'rows': [
            {'date': WEEK_START.isoformat(), 'type': 'Kingpin Suite', 'count': 2},
        ]})
        self._write('employees.json', {'employees': [{
            'displayName': 'Sam',
            'roles': ['Line'],
            'days': {
                WEEK_START.isoformat(): {'hours': 4, 'laborCost': 60, 'byRole': {'Line': {'hours': 4, 'laborCost': 60}}},
                (WEEK_START + timedelta(days=1)).isoformat(): {'hours': 3, 'laborCost': 40, 'byRole': {'Line': {'hours': 3, 'laborCost': 40}}},
            },
        }]})
        self._write('tickets/2026-06.json', [
            {'date': '2026-06-30', 'type': 'Refund', 'total': -40, 'txnId': 'A', 'user': 'Sam'},
            {'date': '2026-06-01', 'type': 'Refund', 'total': -999, 'txnId': 'old', 'user': 'Sam'},
        ])
        self._write('tickets/2026-07.json', [
            {'date': '2026-07-02', 'type': 'Refund', 'total': -90, 'txnId': 'B', 'user': 'Sam'},
            {'date': '2026-07-10', 'type': 'Refund', 'total': -500, 'txnId': 'later', 'user': 'Sam'},
        ])
        metrics = gather_period('week', WEEK_START, WEEK_END, str(self.data), _config())
        self.assertTrue(metrics['show_numbers'])
        self.assertAlmostEqual(metrics['net_sales'], 200.0)
        self.assertAlmostEqual(metrics['prize_fund'], 15.0)
        self.assertAlmostEqual(metrics['departments'][0]['sales'], 100.0)
        self.assertAlmostEqual(metrics['departments'][0]['ly'], 1000.0)
        self.assertAlmostEqual(metrics['bowling']['games'], 40.0)
        self.assertEqual(metrics['labor']['days_with_labor'], 2)
        self.assertEqual(metrics['labor']['days'], 7)
        self.assertFalse(metrics['labor']['reliable'])
        self.assertEqual(metrics['parties']['count'], 2)
        self.assertEqual(metrics['refund_count'], 2)
        self.assertEqual(metrics['refund_tickets'][0]['txnId'], 'B')
        self.assertAlmostEqual(metrics['roles'][0]['hours'], 7.0)
        self.assertAlmostEqual(metrics['tips'], 10.0)
        titles = [flag['title'] for flag in metrics['flags']]
        self.assertTrue(any(title.startswith('Cafe down') for title in titles))
        self.assertFalse(any(title.startswith('Labor ') and 'of sales' in title for title in titles))
        self.assertTrue(metrics['history'])
        self.assertEqual(metrics['history'][-1]['label'], metrics['label'])

    def test_stale_file_hides_the_numbers(self):
        self._write('summary.json', {
            'generatedAt': '2026-06-01T05:31:00',
            'dateRange': ['2023-01-01', '2026-07-05'],
            'nonRevenue': {'departments': {}},
        })
        self._write('transactions.json', [])
        metrics = gather_period('week', WEEK_START, WEEK_END, str(self.data), _config())
        self.assertFalse(metrics['show_numbers'])
        self.assertIn('not ready', metrics['banner'])
        self.assertEqual(metrics['synopsis'], [])


class RenderTests(unittest.TestCase):
    def _shown(self, **overrides):
        metrics = _base(**overrides)
        metrics.update({
            'start': '2026-09-01',
            'end': '2026-09-30',
            'ly_start': '2025-09-01',
            'ly_end': '2025-09-30',
            'pos_generated_at': '2026-10-01T05:31:00',
            'departments': [
                {'id': gid, 'label': label, 'sales': 10, 'ly': 10, 'delta_pct': 0, 'top_items': []}
                for gid, label in (
                    ('food', 'Cafe'), ('bar', 'Bar'), ('bowling', 'Bowling'),
                    ('parties', 'Parties'), ('leagues', 'Leagues'), ('other', 'Other'),
                )
            ],
        })
        metrics.update(overrides)
        return metrics

    def test_caps_and_week_omits_role_table(self):
        flags = [{'title': f'Flag {i}', 'detail': 'detail'} for i in range(8)]
        roles = [{'name': f'Role {i}', 'hours': 10 - i, 'cost': 100} for i in range(8)]
        synopsis = [f'Sentence {i} stands.' for i in range(8)]
        text = render_markdown(self._shown(flags=flags, roles=roles, synopsis=synopsis))
        self.assertIn('Sentence 4 stands.', text)
        self.assertNotIn('Sentence 5 stands.', text)
        self.assertIn('Flag 4.', text)
        self.assertNotIn('Flag 5.', text)
        self.assertIn('+3 more.', text)
        self.assertIn('Other', text)
        self.assertNotIn('Role 6', text)
        self.assertIn('Labor by role', text)
        self.assertEqual(text.count('| Cafe |'), 1)
        week = render_markdown(self._shown(kind='week', title='Oct 5–11, 2026'))
        self.assertNotIn('Labor by role', week)
        self.assertIn('Concourse Bowling Weekly Sales', week)

    def test_dashboard_link_is_optional(self):
        quiet = render_markdown(self._shown())
        self.assertNotIn('dashboard', quiet.lower())
        linked = render_markdown(self._shown(dashboard_url='https://example.test/overview'))
        self.assertIn('https://example.test/overview', linked)

    def test_daily_header_is_unchanged_when_no_brand_is_passed(self):
        html_body = render_html(
            '# Concourse Bowling Daily Sales\n\n<p data-date="1">Monday, Jun 15</p>\n',
            '2026-06-15',
        )
        self.assertIn('Concourse Bowling Daily Sales', html_body)
        self.assertNotIn('Weekly Sales', html_body)
        self.assertNotIn('Monthly Sales', html_body)


if __name__ == '__main__':
    unittest.main()
