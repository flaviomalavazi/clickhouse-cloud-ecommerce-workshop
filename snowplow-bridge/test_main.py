"""Tests for the Micro -> snowplow_events mapping. Run with `make test`."""

from main import COLUMN_NAMES, device_from_yauaa, map_event


def micro_event(yauaa: dict | None, **fields) -> dict:
    """The shape Micro returns from /micro/good, with the YAUAA context optional."""
    ev = {
        'event_id': '11111111-1111-4111-8111-111111111111',
        'collector_tstamp': '2026-10-19T16:02:00.071Z',
        'dvce_created_tstamp': '2026-10-19T16:01:59.900Z',
        'event': 'struct', 'se_category': 'checkout', 'se_action': 'payment_confirmed',
        'se_label': 'pix', 'se_property': '4242', 'se_value': '99.5',
        'domain_userid': 'abc123', 'domain_sessionid': '22222222-2222-4222-8222-222222222222',
        'br_family': None, 'os_family': None, 'dvce_type': None,
        **fields,
    }
    if yauaa is not None:
        ev['derived_contexts'] = {
            'schema': 'iglu:com.snowplowanalytics.snowplow/contexts/jsonschema/1-0-0',
            'data': [{'schema': 'iglu:nl.basjes/yauaa_context/jsonschema/1-0-5', 'data': yauaa}],
        }
    return {'event': ev}


# What Micro's YAUAA enrichment returned for a desktop Chrome on macOS.
MAC_CHROME = {
    'agentName': 'Chrome', 'deviceClass': 'Desktop',
    'operatingSystemName': 'Mac OS', 'operatingSystemNameVersionMajor': 'Mac OS >=10.15',
}


def test_desktop_chrome_on_mac_uses_the_producers_vocabulary():
    assert device_from_yauaa(micro_event(MAC_CHROME)['event']) == ('Chrome', 'Mac OS X', 'Computer')


def test_windows_keeps_the_major_version():
    yauaa = {'agentName': 'Firefox', 'deviceClass': 'Desktop',
             'operatingSystemName': 'Windows NT', 'operatingSystemNameVersionMajor': 'Windows 10'}
    assert device_from_yauaa(micro_event(yauaa)['event']) == ('Firefox', 'Windows 10', 'Computer')


def test_mobile_browsers_get_the_mobile_names():
    safari = {'agentName': 'Safari', 'deviceClass': 'Phone', 'operatingSystemName': 'iOS'}
    chrome = {'agentName': 'Chrome', 'deviceClass': 'Phone', 'operatingSystemName': 'Android'}
    assert device_from_yauaa(micro_event(safari)['event']) == ('Mobile Safari', 'iOS', 'Mobile')
    assert device_from_yauaa(micro_event(chrome)['event']) == ('Chrome Mobile', 'Android', 'Mobile')


def test_unknown_values_become_empty():
    yauaa = {'agentName': 'Unknown', 'deviceClass': 'Robot', 'operatingSystemName': 'Unknown'}
    assert device_from_yauaa(micro_event(yauaa)['event']) == ('', '', '')


def test_no_yauaa_context_gives_empty_strings():
    assert device_from_yauaa(micro_event(None)['event']) == ('', '', '')


def test_map_event_fills_device_columns_and_every_table_column():
    row = map_event(micro_event(MAC_CHROME))
    assert (row['br_family'], row['os_family'], row['dvce_type']) == ('Chrome', 'Mac OS X', 'Computer')
    assert set(COLUMN_NAMES) <= set(row)
    # The order id rides in se_property, which is how orders join to the clickstream.
    assert row['event_name'] == 'checkout_payment_confirmed' and row['se_property'] == '4242'


def test_a_value_micro_already_provides_is_not_overwritten():
    row = map_event(micro_event(MAC_CHROME, br_family='Edge'))
    assert row['br_family'] == 'Edge'


# ── flush(): take events out of Micro first, never lose them to a slow insert ──

from unittest.mock import MagicMock, patch

import pytest
from opentelemetry import trace

import main


@pytest.fixture(autouse=True)
def empty_backlog():
    main._pending.clear()
    yield
    main._pending.clear()


def counters():
    return {'_tracer': trace.get_tracer('test'), 'events_inserted': MagicMock(), 'events_failed': MagicMock()}


def micro(good: list, calls: list, reset_ok: bool = True):
    """Patches Micro's /micro/good and /micro/reset, recording the call order."""
    def get(url, **_):
        calls.append('get'); r = MagicMock(); r.json.return_value = good; return r

    def post(url, **_):
        calls.append('reset'); r = MagicMock()
        if not reset_ok:
            r.raise_for_status.side_effect = RuntimeError('micro is down')
        return r
    return patch.multiple('main.requests', get=get, post=post)


def ch(calls: list, fail: bool = False):
    client = MagicMock()
    def insert(table, data, **_):
        calls.append(f'insert:{len(data)}')
        if fail:
            raise RuntimeError('clickhouse is unreachable')
    client.insert.side_effect = insert
    return client


def test_micro_is_reset_before_the_insert_runs():
    calls: list = []
    with micro([micro_event(MAC_CHROME)] * 3, calls):
        main.flush(ch(calls), counters())
    # The reset has to come first: whatever Micro receives while a slow insert runs
    # would otherwise be wiped with the batch.
    assert calls == ['get', 'reset', 'insert:3']


def test_a_failed_insert_is_retried_from_memory_even_if_micro_is_empty():
    calls: list = []
    with micro([micro_event(MAC_CHROME)] * 2, calls):
        main.flush(ch(calls, fail=True), counters())
    assert len(main._pending) == 2            # kept, not lost

    calls.clear()
    with micro([], calls):                    # Micro has nothing new
        main.flush(ch(calls), counters())
    assert calls == ['get', 'insert:2'] and main._pending == []


def test_a_failed_reset_leaves_the_events_in_micro_and_inserts_nothing():
    calls: list = []
    with micro([micro_event(MAC_CHROME)], calls, reset_ok=False):
        main.flush(ch(calls), counters())
    assert calls == ['get', 'reset'] and main._pending == []   # no duplicate on the next fetch


def test_the_backlog_is_capped_and_the_oldest_events_are_dropped():
    calls: list = []
    with patch.object(main, 'MAX_PENDING', 3), micro([micro_event(MAC_CHROME, event_id=str(i)) for i in range(5)], calls):
        main.flush(ch(calls, fail=True), counters())
    assert [r['event_id'] for r in main._pending] == ['2', '3', '4']
