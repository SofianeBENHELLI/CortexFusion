import pytest

from scripts.qualification_clock import ClockDiscontinuity, Continuity, Deadline


def clocks():
    now = [1000.0, 100.0]
    return now, {"wall": lambda: now[0], "active": lambda: now[1]}


def test_deadline_expires_after_sleep_even_when_active_clock_stops():
    now, clock = clocks()
    deadline = Deadline(60, **clock)
    now[0] += 61
    assert deadline.expired()


def test_backward_wall_clock_cannot_extend_active_deadline():
    now, clock = clocks()
    deadline = Deadline(60, **clock)
    now[0] -= 60
    now[1] += 61
    assert deadline.expired()


def test_continuous_run_does_not_expire_due_to_elapsed_run_length():
    now, clock = clocks()
    guard = Continuity(**clock)
    for _ in range(1000):
        now[0] += 0.25
        now[1] += 0.25
        guard.check()
    assert guard.report()["valid"]


@pytest.mark.parametrize("jump", [(30, 0), (30, 30), (-1, 0.25), (3, 0.25)])
def test_sleep_scheduling_gap_or_clock_change_invalidates_run_permanently(jump):
    now, clock = clocks()
    guard = Continuity(**clock)
    now[0] += jump[0]
    now[1] += jump[1]
    with pytest.raises(ClockDiscontinuity):
        guard.check()
    assert not guard.report()["valid"]
    now[0] += 0.25
    now[1] += 0.25
    with pytest.raises(ClockDiscontinuity):
        guard.check()


def test_reader_rejects_response_received_after_sleep_without_counting_a_success():
    from scripts.qualify_brain_scale import Reader

    now, clock = clocks()
    guard = Continuity(**clock)

    class Signer:
        def headers(self):
            return {}

    class Client:
        def get(self, *args, **kwargs):
            now[0] += 30
            return None  # Even response inspection must not happen after interruption.

    with pytest.raises(ClockDiscontinuity):
        Reader(Client(), Signer(), Deadline(60, **clock), guard).get("/synthetic")
    assert not guard.report()["valid"]
    now[0] += 0.25
    now[1] += 0.25
    with pytest.raises(ClockDiscontinuity):
        guard.check()
