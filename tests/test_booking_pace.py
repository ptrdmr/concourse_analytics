"""Event-date resolution and the booking snapshot. No database."""

from __future__ import annotations

import os
import sys
import unittest
from datetime import date
from tempfile import TemporaryDirectory

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

import booking_pace  # noqa: E402
import pull_bookings  # noqa: E402

TODAY = '2026-10-22'
CONFIG = booking_pace.load_config()


def deposit_ticket(txn, day, name, amount, tender='Meriq Online Deposit'):
    return {
        'txnId': str(txn),
        'date': day,
        'type': 'Sales',
        'items': [
            {'name': name, 'itemType': 'Account', 'total': amount},
            {'name': tender, 'itemType': 'PaymentCash', 'total': amount},
        ],
    }


def sales_tab(txn, day, product):
    return {
        'txnId': str(txn),
        'date': day,
        'type': 'Sales',
        'items': [
            {'name': product, 'itemType': 'Product', 'total': 100, 'dept': 'Bowling', 'subdept': ''},
        ],
    }


def snapshot(reservations=None, ledger=None, accounts=None):
    return {
        'pulledAt': '2026-10-22T12:00:00',
        'reservations': reservations or [],
        'ledger': ledger or [],
        'accounts': accounts or [],
    }


def reservation(rid, event, account, txn_ids, rtype='Supercharge', title='Party', gone_at=None):
    row = {
        'id': rid,
        'created': '2026-09-01T10:00:00',
        'event': event,
        'statusId': 2,
        'type': rtype,
        'accountId': account,
        'transactionId': txn_ids[-1] if txn_ids else None,
        'title': title,
        'parentId': None,
        'txnIds': list(txn_ids),
    }
    if gone_at:
        row['goneAt'] = gone_at
    return row


def ledger(lid, account, at, amount, txn):
    return {'id': lid, 'accountId': account, 'at': at, 'amount': amount, 'txnId': txn}


def account(aid, name, collection):
    return {'id': aid, 'name': name, 'collection': collection}


def build(tickets, snap, overrides=None, today=TODAY, history=None):
    by_month = {'2026-09': tickets}
    payload = booking_pace.build_payload(
        by_month,
        snap,
        CONFIG,
        overrides or ({}, {}),
        today,
        'snapshot',
        history,
    )
    return payload


class NameDateTests(unittest.TestCase):
    def test_leading_and_trailing(self):
        self.assertEqual(booking_pace.parse_name_date('12/11/2026 Smith'), '2026-12-11')
        self.assertEqual(booking_pace.parse_name_date('McCandless Tile 12.11.26'), '2026-12-11')
        self.assertEqual(booking_pace.parse_name_date('C&S Assembly 12-05-25'), '2025-12-05')

    def test_invalid_and_missing(self):
        self.assertIsNone(booking_pace.parse_name_date('Yesenia Hernandez'))
        self.assertIsNone(booking_pace.parse_name_date('Party 2/31/26'))

    def test_business_day_rolls_before_4am(self):
        self.assertEqual(booking_pace.business_day('2026-12-05T03:59:00'), '2026-12-04')
        self.assertEqual(booking_pace.business_day('2026-12-05T04:00:00'), '2026-12-05')


class ResolutionTests(unittest.TestCase):
    def test_past_party_uses_closeout_not_the_booking(self):
        tickets = [
            deposit_ticket(100, '2026-09-03', 'Serrano Water', 1800, 'VIP Suite Payment'),
            sales_tab(200, '2026-12-11', 'Strike Zone - 4 Lane Suite - Time'),
        ]
        snap = snapshot(
            [reservation(1, '2026-12-09', 5, [100, 200], 'Strikezone 4 Lane Suite', 'Serrano Water')],
            [
                ledger(1, 5, '2026-09-03T12:00:00', 1800, 100),
                ledger(2, 5, '2026-12-11T18:00:00', -1800, 200),
            ],
            [account(5, 'Serrano Water', 'VIP Suites')],
        )
        row = build(tickets, snap)['payments'][0]
        self.assertEqual(row['event'], '2026-12-11')
        self.assertEqual(row['eventSource'], 'redeemed')
        self.assertTrue(row['eventConflict'])
        self.assertEqual(row['status'], 'completed')
        self.assertEqual(row['type'], 'Strike Zone Suite')
        self.assertEqual(row['typeSource'], 'tab')
        self.assertEqual(row['group'], 'suites')

    def test_one_day_apart_is_not_a_conflict(self):
        tickets = [deposit_ticket(100, '2026-09-03', 'Serrano Water', 1800)]
        snap = snapshot(
            [reservation(1, '2026-12-10', 5, [100], 'Supercharge')],
            [
                ledger(1, 5, '2026-09-03T12:00:00', 1800, 100),
                ledger(2, 5, '2026-12-11T18:00:00', -1800, 999),
            ],
            [account(5, 'Serrano Water', 'Supercharge')],
        )
        row = build(tickets, snap)['payments'][0]
        self.assertEqual(row['event'], '2026-12-11')
        self.assertFalse(row['eventConflict'])

    def test_closeout_before_4am_rolls_back(self):
        tickets = [deposit_ticket(100, '2026-09-03', 'Late Close', 100)]
        snap = snapshot(
            [reservation(1, '2026-12-05', 5, [100], 'Supercharge')],
            [
                ledger(1, 5, '2026-09-03T12:00:00', 100, 100),
                ledger(2, 5, '2026-12-05T02:30:00', -100, 200),
            ],
            [account(5, 'Late Close', 'Supercharge')],
        )
        row = build(tickets, snap)['payments'][0]
        self.assertEqual(row['event'], '2026-12-04')
        self.assertEqual(row['eventSource'], 'redeemed')

    def test_same_day_transfer_does_not_become_the_event(self):
        # Deposit and the balancing negative are 18 seconds apart. The date
        # staff typed on the account is the party.
        tickets = [deposit_ticket(100, '2024-12-10', 'manheim', 21676.22, 'VIP Suite Payment')]
        snap = snapshot(
            ledger=[
                ledger(1, 5, '2024-12-10T15:38:23', 21676.22, 100),
                ledger(2, 5, '2024-12-10T15:38:41', -21676.22, 200),
            ],
            accounts=[account(5, 'manheim 12-13-24', 'VIP Suites')],
        )
        row = build(tickets, snap, today='2024-12-20')['payments'][0]
        self.assertEqual(row['event'], '2024-12-13')
        self.assertEqual(row['eventSource'], 'name')
        self.assertFalse(row['eventConflict'])
        self.assertEqual(row['status'], 'completed')
        self.assertEqual(row['party'], 'manheim')

    def test_future_party_uses_the_booking_not_the_typed_name(self):
        tickets = [deposit_ticket(100, '2026-10-12', 'The Panthers FC 11-21-26', 276.04)]
        snap = snapshot(
            [reservation(1, '2026-11-14', 5, [100], 'Special Event', 'The Panthers FC')],
            [ledger(1, 5, '2026-10-12T13:00:00', 276.04, 100)],
            [account(5, 'The Panthers FC 11-21-26', 'Event')],
        )
        row = build(tickets, snap)['payments'][0]
        self.assertEqual(row['event'], '2026-11-14')
        self.assertEqual(row['eventSource'], 'db')
        self.assertTrue(row['eventConflict'])
        self.assertEqual(row['status'], 'booked')
        self.assertEqual(row['party'], 'The Panthers FC')

    def test_override_wins_and_is_flagged_when_it_disagrees(self):
        tickets = [deposit_ticket(100, '2026-09-03', 'Yesenia Hernandez', 2795.62, 'Supercharge Payment')]
        snap = snapshot(
            [reservation(1, '2026-12-09', 5, [100], 'Supercharge', 'Yesenia Hernandez')],
            [ledger(1, 5, '2026-09-03T15:23:13', 2795.62, 100)],
            [account(5, 'Yesenia Hernandez', 'Supercharge')],
        )
        payload = build(tickets, snap, overrides=({'100': '2026-12-02'}, {}))
        row = payload['payments'][0]
        self.assertEqual(row['event'], '2026-12-02')
        self.assertEqual(row['eventSource'], 'override')
        self.assertTrue(row['eventConflict'])
        self.assertEqual(payload['conflicts'], 1)

    def test_second_payment_counts_dollars_but_not_a_second_event(self):
        tickets = [
            deposit_ticket(100, '2026-09-03', 'CAI', 3897, 'VIP Suite Payment'),
            deposit_ticket(101, '2026-10-02', 'CAI', 1000, 'VIP Suite Payment'),
        ]
        snap = snapshot(
            [reservation(1, '2026-12-12', 5, [100], 'Powerhouse 12 Lane Suite', 'CAI')],
            [
                ledger(1, 5, '2026-09-03T12:00:00', 3897, 100),
                ledger(2, 5, '2026-10-02T12:00:00', 1000, 101),
            ],
            [account(5, 'CAI', 'VIP Suites')],
        )
        rows = build(tickets, snap)['payments']
        self.assertEqual([row['isFirstPayment'] for row in rows], [True, False])
        self.assertEqual(sum(row['amount'] for row in rows), 4897)
        self.assertEqual({row['event'] for row in rows}, {'2026-12-12'})
        self.assertEqual(rows[0]['type'], 'Powerhouse Suite')
        self.assertEqual(rows[0]['typeSource'], 'rsv')

    def test_one_tab_two_accounts_stay_separate(self):
        tickets = [
            deposit_ticket(100, '2026-10-10', 'CAI', 3897, 'VIP Suite Payment'),
            deposit_ticket(101, '2026-12-12', 'CAI WIngs 12-12-25', 862.95, 'VIP Suite Payment'),
            sales_tab(200, '2026-12-12', 'Powerhouse - 12 Lane Suite - Time'),
        ]
        snap = snapshot(
            [],
            [
                ledger(1, 5, '2025-10-10T12:00:00', 3897, 100),
                ledger(2, 5, '2025-12-12T18:00:00', -3897, 200),
                ledger(3, 6, '2025-12-12T14:00:00', 862.95, 101),
                ledger(4, 6, '2025-12-12T18:00:00', -862.95, 200),
            ],
            [
                account(5, 'CAI', 'VIP Suites'),
                account(6, 'CAI WIngs', 'VIP Suites'),
            ],
        )
        # Paid dates on the tickets are what the window filters. Use 2025 dates via the tickets.
        tickets[0]['date'] = '2025-10-10'
        tickets[1]['date'] = '2025-12-12'
        rows = build(tickets, snap, today='2026-01-01')['payments']
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row['isFirstPayment'] for row in rows))
        self.assertEqual({row['event'] for row in rows}, {'2025-12-12'})
        self.assertEqual({row['accountId'] for row in rows}, {5, 6})
        self.assertEqual({row['status'] for row in rows}, {'completed'})

    def test_unknown_date_is_counted(self):
        tickets = [deposit_ticket(100, '2026-09-03', 'No Date Party', 50, 'Cash')]
        payload = build(tickets, snapshot())
        self.assertEqual(payload['unknownEvent'], {'count': 1, 'amount': 50})
        row = payload['payments'][0]
        self.assertIsNone(row['event'])
        self.assertEqual(row['eventSource'], 'unknown')
        self.assertEqual(row['status'], 'unknown')

    def test_name_is_the_fallback_when_the_booking_is_gone(self):
        tickets = [deposit_ticket(100, '2026-09-06', '9/6/2026 Alison Pashley', 245.14)]
        payload = build(tickets, snapshot(
            ledger=[ledger(1, 5, '2026-09-06T12:00:00', 245.14, 100)],
            accounts=[account(5, '9/6/2026 Alison Pashley', 'Event')],
        ))
        row = payload['payments'][0]
        self.assertEqual(row['event'], '2026-09-06')
        self.assertEqual(row['eventSource'], 'name')
        self.assertEqual(row['status'], 'unredeemed')
        self.assertEqual(row['type'], 'General Lane Reservation')
        self.assertEqual(row['group'], 'lanes')

    def test_refund_is_not_the_event_date(self):
        tickets = [
            deposit_ticket(100, '2026-09-03', 'Yesenia Hernandez', 500, 'Supercharge Payment'),
            {'txnId': '300', 'date': '2026-09-10', 'type': 'Refund', 'items': []},
        ]
        snap = snapshot(
            [reservation(1, '2026-12-02', 5, [100], 'Supercharge', 'Yesenia Hernandez')],
            [
                ledger(1, 5, '2026-09-03T12:00:00', 500, 100),
                ledger(2, 5, '2026-09-10T12:00:00', -500, 300),
            ],
            [account(5, 'Yesenia Hernandez', 'Supercharge')],
        )
        row = build(tickets, snap)['payments'][0]
        self.assertEqual(row['event'], '2026-12-02')
        self.assertEqual(row['eventSource'], 'db')
        self.assertEqual(row['status'], 'cancelled')

    def test_vanished_future_booking_is_cancelled_but_keeps_its_date(self):
        tickets = [deposit_ticket(100, '2026-09-03', 'Gone Party', 100, 'Supercharge Payment')]
        snap = snapshot(
            [reservation(1, '2026-12-02', 5, [100], 'Supercharge', 'Gone Party', gone_at='2026-10-01')],
            [ledger(1, 5, '2026-09-03T12:00:00', 100, 100)],
            [account(5, 'Gone Party', 'Supercharge')],
        )
        row = build(tickets, snap)['payments'][0]
        self.assertEqual(row['event'], '2026-12-02')
        self.assertEqual(row['status'], 'cancelled')

    def test_type_falls_through_reservation_then_category_then_tender_then_lanes(self):
        # Category wins when the reservation type is generic.
        tickets = [deposit_ticket(100, '2026-09-03', 'Online Guest', 100)]
        snap = snapshot(
            [reservation(1, '2026-11-01', 5, [100], 'Online Reservations')],
            [ledger(1, 5, '2026-09-03T12:00:00', 100, 100)],
            [account(5, 'Online Guest', 'Supercharge')],
        )
        row = build(tickets, snap)['payments'][0]
        self.assertEqual((row['type'], row['typeSource']), ('Supercharge', 'collection'))

        # Tender wins when there is no booking and no category.
        tickets = [deposit_ticket(100, '2026-09-03', 'Suite Guest', 100, 'VIP Suite Payment')]
        row = build(tickets, snapshot())['payments'][0]
        self.assertEqual((row['type'], row['group'], row['typeSource']), ('VIP Suite', 'suites', 'tender'))

        # A lane deposit with only the online tender stays in lanes.
        tickets = [deposit_ticket(100, '2026-09-03', 'Lane Guest', 100)]
        row = build(tickets, snapshot())['payments'][0]
        self.assertEqual((row['type'], row['group'], row['typeSource']),
                         ('General Lane Reservation', 'lanes', 'tender'))


class SnapshotTests(unittest.TestCase):
    def test_merge_marks_a_future_booking_that_disappears(self):
        existing = snapshot(
            reservations=[
                reservation(1, '2026-12-02', 5, [100]),
                reservation(2, '2026-08-01', 6, [101]),
            ],
            ledger=[ledger(1, 5, '2026-09-03T12:00:00', 100, 100)],
        )
        pulled = {
            'pulledAt': '2026-10-22T13:00:00',
            'reservations': [reservation(2, '2026-08-01', 6, [101])],
            'ledger': [ledger(1, 5, '2026-09-03T12:00:00', 100, 100)],
            'accounts': [],
        }
        merged = pull_bookings.merge_snapshot(existing, pulled, '2026-10-22')
        by_id = {row['id']: row for row in merged['reservations']}
        self.assertEqual(by_id[1].get('goneAt'), '2026-10-22')
        self.assertNotIn('goneAt', by_id[2])
        self.assertEqual(len(merged['ledger']), 1)

    def test_merge_clears_gone_when_the_booking_returns_and_keeps_old_ledger(self):
        existing = snapshot(
            reservations=[reservation(1, '2026-12-02', 5, [100], gone_at='2026-10-01')],
            ledger=[ledger(9, 5, '2026-09-03T12:00:00', 40, 100)],
        )
        pulled = {
            'pulledAt': '2026-10-23T13:00:00',
            'reservations': [reservation(1, '2026-12-02', 5, [100])],
            'ledger': [ledger(10, 5, '2026-10-23T12:00:00', 10, 101)],
            'accounts': [account(5, 'Back', 'Event')],
        }
        merged = pull_bookings.merge_snapshot(existing, pulled, '2026-10-23')
        self.assertNotIn('goneAt', merged['reservations'][0])
        self.assertEqual([row['id'] for row in merged['ledger']], [9, 10])

    def test_database_down_uses_the_snapshot_on_disk(self):
        with TemporaryDirectory() as folder:
            path = os.path.join(folder, 'booking_snapshot.json')
            saved = snapshot(reservations=[reservation(1, '2026-12-02', 5, [100])])
            pull_bookings.atomic_write(path, saved)

            def down():
                raise RuntimeError('PWD=secret; login failed')

            status, loaded = booking_pace.acquire_snapshot(down, path)
            self.assertEqual(status, 'snapshot')
            self.assertEqual(loaded['reservations'][0]['id'], 1)

            status, loaded = booking_pace.acquire_snapshot(lambda: saved, path)
            self.assertEqual(status, 'live')


class MatchTests(unittest.TestCase):
    def test_cai_does_not_steal_cai_manheim(self):
        rows = [
            {'party': 'CAI', 'amount': 3897, 'event': '2025-12-12'},
            {'party': 'CAI- MANHEIM', 'amount': 3897.0, 'event': '2026-12-04'},
            {'party': 'A New View Windows & Doors', 'amount': 1650, 'event': '2026-12-11'},
        ]
        matched, missing, extra = booking_pace.match_parties(rows, [
            ('cai', 3897),
            ('cai-manheim', 3897),
            ('a new view windows', 1650),
        ])
        self.assertEqual(missing, [])
        self.assertEqual(extra, [])
        self.assertTrue(all(ok for _n, _d, _row, ok in matched))


class DepositHistoryTests(unittest.TestCase):
    def test_history_replaces_the_late_pos_deposit(self):
        tickets = [deposit_ticket(100, '2024-12-10', 'manheim', 10000, 'VIP Suite Payment')]
        snap = snapshot(
            ledger=[ledger(1, 5, '2024-12-10T12:00:00', 10000, 100)],
            accounts=[account(5, 'manheim 12-13-24', 'VIP Suites')],
        )
        history = [{
            'account': 'manheim 12-13-24', 'event': '2024-12-13',
            'paid': '2024-09-26', 'amount': 10000, 'invoice': '159', 'source': '17hats',
        }]
        rows = build(tickets, snap, today='2024-12-20', history=history)['payments']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['paid'], '2024-09-26')
        self.assertEqual(rows[0]['paidSource'], '17hats')
        self.assertEqual(rows[0]['event'], '2024-12-13')
        self.assertEqual(rows[0]['party'], 'manheim')
        self.assertTrue(rows[0]['isFirstPayment'])
        self.assertEqual(rows[0]['amount'], 10000)

    def test_pre_window_gap_is_the_first_payment(self):
        tickets = [deposit_ticket(100, '2024-12-03', 'KDC', 18193.69, 'VIP Suite Payment')]
        snap = snapshot(
            ledger=[ledger(1, 5, '2024-12-03T12:00:00', 18193.69, 100)],
            accounts=[account(5, 'KDC 12-06-24', 'VIP Suites')],
        )
        history = [
            {'account': 'KDC 12-06-24', 'event': '2024-12-06', 'paid': '2024-09-02',
             'amount': 4500, 'invoice': '124', 'source': '17hats', 'note': 'paid before 17hats export'},
            {'account': 'KDC 12-06-24', 'event': '2024-12-06', 'paid': '2024-12-03',
             'amount': 13693.69, 'invoice': '124', 'source': '17hats'},
        ]
        rows = build(tickets, snap, today='2024-12-20', history=history)['payments']
        self.assertEqual(len(rows), 2)
        self.assertEqual([row['paid'] for row in rows], ['2024-09-02', '2024-12-03'])
        self.assertEqual([row['isFirstPayment'] for row in rows], [True, False])
        self.assertAlmostEqual(sum(row['amount'] for row in rows), 18193.69, places=2)

    def test_history_without_a_pos_deposit_is_still_added(self):
        history = [{
            'account': 'Strike Zone - Infinity Solar', 'event': '2024-12-14',
            'paid': '2024-10-29', 'amount': 980, 'invoice': '182', 'source': '17hats',
        }]
        rows = build([], snapshot(), today='2024-12-20', history=history)['payments']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['paid'], '2024-10-29')
        self.assertEqual(rows[0]['event'], '2024-12-14')
        self.assertEqual(rows[0]['type'], 'Strike Zone Suite')
        self.assertEqual(rows[0]['group'], 'suites')
        self.assertEqual(rows[0]['paidSource'], '17hats')

    def test_same_name_in_another_year_is_kept(self):
        tickets = [deposit_ticket(100, '2025-09-29', 'Serrano Water', 1800, 'VIP Suite Payment')]
        snap = snapshot(
            [reservation(1, '2025-12-11', 5, [100], 'Strikezone 4 Lane Suite', 'Serrano Water')],
            [ledger(1, 5, '2025-09-29T12:00:00', 1800, 100)],
            [account(5, 'Serrano Water', 'VIP Suites')],
        )
        history = [{
            'account': 'serrano 12-12-24', 'event': '2024-12-12',
            'paid': '2024-09-12', 'amount': 1260, 'invoice': '153', 'source': '17hats',
        }]
        rows = build(tickets, snap, today='2025-12-20', history=history)['payments']
        kept = [row for row in rows if row['paidSource'] == 'pos']
        added = [row for row in rows if row['paidSource'] == '17hats']
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0]['event'], '2025-12-11')
        self.assertEqual(len(added), 1)
        self.assertEqual(added[0]['event'], '2024-12-12')

    def test_no_history_leaves_pos_dates(self):
        tickets = [deposit_ticket(100, '2024-12-10', 'manheim', 10000, 'VIP Suite Payment')]
        snap = snapshot(
            ledger=[ledger(1, 5, '2024-12-10T12:00:00', 10000, 100)],
            accounts=[account(5, 'manheim 12-13-24', 'VIP Suites')],
        )
        plain = build(tickets, snap, today='2024-12-20')['payments']
        empty = build(tickets, snap, today='2024-12-20', history=[])['payments']
        self.assertEqual(plain[0]['paid'], '2024-12-10')
        self.assertEqual(plain[0]['paidSource'], 'pos')
        self.assertEqual(plain[0]['paid'], empty[0]['paid'])
        self.assertEqual(plain[0]['amount'], empty[0]['amount'])
        self.assertEqual(build(tickets, snap, today='2024-12-20')['history'], [])


if __name__ == '__main__':
    unittest.main()
