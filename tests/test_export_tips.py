"""Tip fact collection: tags, party tabs, reservation windows, punch slices."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from export_tips import (  # noqa: E402
    TipLedger,
    accumulate_csv_row,
    business_day,
    calendar_day_for_business,
    clean_party_name,
    crew_tag_label,
    load_tip_rules,
    reservations_from_snapshot,
    shape_reservations,
    slice_punch,
    tabs_from_accumulator,
)

TZ = ZoneInfo('America/Los_Angeles')
RULES = load_tip_rules()
CHARGES = {'matchSuffix': 'Service Charge', 'excludeNames': ['Processing Fee']}


def line(**kwargs):
    base = {
        'txn_id': '1',
        'txn_type': 'Sales',
        'name': '',
        'item_type': 'Product',
        'department': 'Food',
        'total': 0,
        'business_date': '2026-11-07',
        'opened': '2026-11-07T16:02:00-08:00',
        'closed': '2026-11-07T20:22:00-08:00',
        'user': 'Sasha',
        'terminal': 'MPOS6',
        'item_at': '2026-11-07T16:10:00-08:00',
    }
    base.update(kwargs)
    return base


def build(rows):
    ledger = TipLedger()
    for row in rows:
        accumulate_csv_row(ledger, row, RULES, CHARGES, 4)
    return tabs_from_accumulator(ledger.finish())


class TagAndPartyTests(unittest.TestCase):
    def test_tag_label(self):
        self.assertEqual(crew_tag_label('Server - Allyssa Boone', RULES), 'Allyssa Boone')
        self.assertEqual(crew_tag_label('Server  -   Sasha Salcedo', RULES), 'Sasha Salcedo')
        self.assertIsNone(crew_tag_label('Server -', RULES))
        self.assertIsNone(crew_tag_label('Coors Light Draft', RULES))

    def test_bar_sales_before_the_service_charge_are_kept(self):
        days = build([
            line(name='Patron', item_type='Product', department='Bar', total='33.00',
                 item_at='2026-11-07T16:30:00-08:00'),
            line(name='Server - Allyssa Boone', department='Bowling', total='0'),
            line(name='Server - Allyssa Boone', department='Bowling', total='0'),
            line(name='Server - Sasha Salcedo', department='Bowling', total='0'),
            line(name='KImberly Hilburn 11.07.26', item_type='Account', department='', total='-1100'),
            line(name='VIP Service Charge', item_type='Adjustment', department='', total='264.00'),
            line(name='VIP Service Charge', item_type='Adjustment', department='', total='36.00'),
            line(name='Sasha', item_type='GratuityIn', department='', total='100.00'),
            line(name='Cadillac Upcharge', item_type='Modifier', department='Bar', total='6.00',
                 item_at='2026-11-07T18:00:00-08:00'),
            line(name='Processing Fee', item_type='Adjustment', department='', total='78.00'),
        ])
        tab = days['2026-11-07'][0]
        self.assertEqual(tab['serviceChargeCents'], 30000)
        self.assertEqual(tab['barSalesCents'], 3900)
        self.assertEqual(tab['coordinators'], ['Allyssa Boone', 'Sasha Salcedo'])
        self.assertEqual(tab['gratuity'], [{'name': 'Sasha', 'cents': 10000}])
        self.assertEqual(tab['partyName'], 'KImberly Hilburn')
        self.assertEqual(tab['firstItem'], '2026-11-07T16:30:00-08:00')
        self.assertEqual(tab['lastItem'], '2026-11-07T18:00:00-08:00')

    def test_account_only_tab_is_not_a_party(self):
        days = build([
            line(txn_id='2', name='11/10/2026 Thomas Clark', item_type='Account', total='-40'),
            line(txn_id='2', name='Time Bowling', department='Bowling', total='40'),
        ])
        self.assertEqual(days, {})

    def test_event_date_not_booking_date(self):
        self.assertEqual(business_day('2026-11-07', '16:02:00', 4), '2026-11-07')
        self.assertEqual(business_day('2026-11-08', '01:10:00', 4), '2026-11-07')
        opened = calendar_day_for_business('2026-11-07', (1, 10, 0), 4)
        self.assertEqual(opened.isoformat(), '2026-11-08')

    def test_party_name_drops_the_typed_date(self):
        self.assertEqual(clean_party_name('KImberly Hilburn 11.07.26'), 'KImberly Hilburn')
        self.assertEqual(clean_party_name('11/7/2026 Shannon Cardinale'), 'Shannon Cardinale')


class ReservationTests(unittest.TestCase):
    def test_suite_resource_is_kept(self):
        windows = shape_reservations([
            {
                'id': 9,
                'title': 'Kimberly Hilburn',
                'type': 'Powerhouse 12 Lane Suite',
                'event': '2026-11-07',
                'resource': 'Lane 4',
                'start': datetime(2026, 11, 7, 16, 0),
                'end': datetime(2026, 11, 7, 18, 0),
                'transaction_id': 848253,
            },
            {
                'id': 9,
                'title': 'Kimberly Hilburn',
                'type': 'Powerhouse 12 Lane Suite',
                'event': '2026-11-07',
                'resource': 'Kingpin Suite',
                'start': datetime(2026, 11, 7, 16, 0),
                'end': datetime(2026, 11, 7, 20, 0),
                'transaction_id': 848253,
            },
        ], [
            {'reservation_id': 9, 'transaction_id': 848254},
        ])
        self.assertEqual(len(windows), 1)
        window = windows[0]
        self.assertEqual(window['txnIds'], ['848253', '848254'])
        self.assertEqual(window['start'], '2026-11-07T16:00:00-08:00')
        self.assertEqual(window['end'], '2026-11-07T20:00:00-08:00')
        self.assertEqual(
            sorted(item['name'] for item in window['resources']),
            ['Kingpin Suite', 'Lane 4'],
        )

    def test_snapshot_links_transactions_without_times(self):
        windows = reservations_from_snapshot({
            'reservations': [{
                'id': 37650,
                'event': '2026-12-03',
                'type': 'Powerhouse 12 Lane Suite',
                'title': 'Orange County Network - CCUL',
                'transactionId': 744730,
                'txnIds': [744729, 744730],
            }],
        })
        self.assertEqual(windows[0]['txnIds'], ['744729', '744730'])
        self.assertIsNone(windows[0]['start'])


class PunchSliceTests(unittest.TestCase):
    def test_shift_crossing_4am_splits_onto_two_business_days(self):
        start = datetime(2026, 11, 8, 2, 0, tzinfo=TZ)
        end = datetime(2026, 11, 8, 10, 0, tzinfo=TZ)
        slices = slice_punch(start, end, 4)
        self.assertEqual(slices[0][0], '2026-11-07')
        self.assertEqual(slices[0][1].hour, 2)
        self.assertEqual(slices[0][2].hour, 4)
        self.assertEqual(slices[1][0], '2026-11-08')
        self.assertEqual(slices[1][1].hour, 4)
        self.assertEqual(slices[1][2].hour, 10)

    def test_evening_shift_stays_on_its_start_day(self):
        start = datetime(2026, 11, 7, 16, 30, tzinfo=TZ)
        end = datetime(2026, 11, 8, 0, 15, tzinfo=TZ)
        slices = slice_punch(start, end, 4)
        self.assertEqual(len(slices), 1)
        self.assertEqual(slices[0][0], '2026-11-07')


if __name__ == '__main__':
    unittest.main()
