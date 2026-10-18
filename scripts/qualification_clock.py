"""Bounds survive machine sleep; interrupted runs never qualify a benchmark."""

import threading
import time


class Deadline:
    def __init__(self, seconds, *, wall=None, active=None):
        self.wall, self.active = wall or time.time, active or time.monotonic
        self.wall_end, self.active_end = self.wall() + seconds, self.active() + seconds

    def expired(self):
        return self.wall() >= self.wall_end or self.active() >= self.active_end


class ClockDiscontinuity(RuntimeError):
    pass


class Continuity:
    """Conservative qualification guard, not a diagnosis of OS sleep.

    A clock divergence >2 seconds or a heartbeat gap >5 seconds invalidates the
    complete run. These are validity thresholds, never latency-budget changes.
    """

    def __init__(self, *, wall=None, active=None):
        self.wall, self.active = wall or time.time, active or time.monotonic
        self.wall_start, self.active_start = self.wall(), self.active()
        self.last_wall, self.last_active = self.wall_start, self.active_start
        self.max_gap = self.max_divergence = 0
        self.invalid = False
        self.lock = threading.Lock()
        self.stopped = threading.Event()

    def check(self):
        with self.lock:
            wall, active = self.wall(), self.active()
            gap = max(wall - self.last_wall, active - self.last_active)
            divergence = abs((wall - self.wall_start) - (active - self.active_start))
            self.max_gap = max(self.max_gap, gap)
            self.max_divergence = max(self.max_divergence, divergence)
            self.invalid |= gap > 5 or divergence > 2 or wall < self.last_wall
            self.last_wall, self.last_active = wall, active
            if self.invalid:
                raise ClockDiscontinuity("Qualification interrupted: clock continuity lost")

    def run(self):
        while not self.stopped.wait(0.25):
            try:
                self.check()
            except ClockDiscontinuity:
                return

    def report(self):
        with self.lock:
            return {
                "valid": not self.invalid,
                "max_heartbeat_gap_seconds": round(self.max_gap, 3),
                "max_clock_divergence_seconds": round(self.max_divergence, 3),
                "gap_limit_seconds": 5,
                "divergence_limit_seconds": 2,
                "sample_interval_seconds": 0.25,
            }
