#!/usr/bin/env python3
"""Exercise the Rails adapter through real Rails commands in a disposable app."""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import uuid


ROOT = Path(__file__).resolve().parent.parent
ADAPTER = ROOT / "adapters/rails/run.rb"
PREFIX = "@@TEST_PROGRESS@@"


def write(app, name, content):
    path = app / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def fixture(app):
    write(app, "Rakefile", '''require_relative "config/application"
Rails.application.load_tasks
''')
    write(app, "bin/rails", '''APP_PATH = File.expand_path("../config/application", __dir__)
require_relative "../config/boot"
require "rails/commands"
''')
    write(app, "Gemfile", '''source "https://rubygems.org"
gem "rails", ENV.fetch("RAILS_VERSION", ">= 7.2")
gem "minitest", ENV.fetch("MINITEST_VERSION", ">= 5.20"), "< 6"
gem "mutex_m"
gem "capybara", "~> 3.40"
gem "selenium-webdriver", "~> 4.0"
''')
    write(app, "config/boot.rb", '''if ENV["FIXTURE_CLEAN_BOOT"]
  raise "reporter activated gems before Bundler" if Gem.loaded_specs.key?("json") || Gem.loaded_specs.key?("securerandom")
end
ENV["BUNDLE_GEMFILE"] = File.expand_path("../Gemfile", __dir__)
require "bundler/setup"
''')
    write(app, "config/application.rb", '''require_relative "boot"
require "rails"
require "action_controller/railtie"
require "rails/test_unit/railtie"
module ProgressFixture
  class Application < Rails::Application
    config.eager_load = false
    config.secret_key_base = "fixture-" * 20
    config.hosts.clear
    config.logger = Logger.new(File::NULL)
  end
end
''')
    write(app, "config/environment.rb", '''require_relative "application"
Rails.application.initialize!
''')
    write(app, "config/routes.rb", '''Rails.application.routes.draw do
  get "/welcome", to: "welcome#index"
end
''')
    write(app, "app/controllers/welcome_controller.rb", '''class WelcomeController < ActionController::Base
  def index
    render inline: "<h1>Progress fixture</h1>"
  end
end
''')
    write(app, "test/test_helper.rb", '''require_relative "../config/environment"
require "rails/test_help"
ActiveSupport::TestCase.test_order = :sorted
if ENV["FIXTURE_PARALLEL"]
  ActiveSupport::TestCase.parallelize(workers: 2, with: ENV.fetch("FIXTURE_PARALLEL").to_sym, threshold: 0)
end
''')
    write(app, "test/models/outcomes_test.rb", '''require "test_helper"
class OutcomesTest < ActiveSupport::TestCase
  def test_a_pass
    puts "native test output"
    assert true
  end
  def test_b_failure
    flunk "intentional fixture failure"
  end
  def test_c_error
    raise "intentional fixture error"
  end
  def test_d_skip
    skip "intentional fixture skip"
  end
end
''')
    write(app, "test/integration/welcome_test.rb", '''require "test_helper"
class WelcomeTest < ActionDispatch::IntegrationTest
  test "renders welcome view" do
    get "/welcome"
    assert_response :success
    assert_select "h1", "Progress fixture"
  end
end
''')
    write(app, "test/system/welcome_test.rb", '''require "test_helper"
require "action_dispatch/system_test_case"
class WelcomeSystemTest < ActionDispatch::SystemTestCase
  driven_by :rack_test
  test "visits welcome page" do
    visit "/welcome"
    assert_selector "h1", text: "Progress fixture"
  end
end
''')


def run(ruby, app, args, adapted=True, extra_env=None):
    env = dict(os.environ, RAILS_ENV="test")
    env.update(extra_env or {})
    command = [ruby, str(ADAPTER) if adapted else "bin/rails"] + args
    result = subprocess.run(command, cwd=str(app), env=env, text=True,
                            capture_output=True, timeout=45)
    events = []
    for line in result.stdout.splitlines():
        if PREFIX in line:
            events.append(json.loads(line.split(PREFIX, 1)[1]))
    for event in events:
        assert event["resolved"] == sum(event[k] for k in ("passed", "failed", "skipped")), event
        assert event["total"] is None or event["resolved"] <= event["total"], event
    return result, events


def check(ruby, app, name, args, counts, expected_exit, extra_env=None):
    native, unused = run(ruby, app, args, adapted=False, extra_env=extra_env)
    result, events = run(ruby, app, args, extra_env=extra_env)
    assert result.returncode == native.returncode and (expected_exit is None or result.returncode == expected_exit), (
        name, native.returncode, result.returncode, result.stdout, result.stderr)
    assert events, (name, result.stdout, result.stderr)
    assert len({event["scope"] for event in events}) == 1, (name, events)
    last = events[-1]
    if counts is None:
        # Some Rails versions load tests through a native plugin, so explicitly
        # disabling plugins can also select zero tests. Preserve that behavior.
        summary = re.search(r"(\d+) runs, \d+ assertions, (\d+) failures, (\d+) errors, (\d+) skips", native.stdout)
        assert summary, (name, native.stdout, native.stderr)
        total, failures, errors, skips = map(int, summary.groups())
        counts = [total - failures - errors - skips, failures + errors, skips]
    assert [last[k] for k in ("passed", "failed", "skipped")] == counts, (name, last, result.stdout, result.stderr)
    assert last["final"], (name, last)
    print(name + ": OK", flush=True)
    return result, events


def collector(ruby, app, cancel=False):
    owner = "rails-check-" + uuid.uuid4().hex
    config = app / "collector.json"
    test_file = "test/models/slow_test.rb" if cancel else "test/models/outcomes_test.rb"
    config.write_text(json.dumps({"schemaVersion": 1, "modules": {"backend": {
        "command": [ruby, str(ADAPTER), "test", test_file], "cwd": ".",
        "adapter": "events", "env": {}}}}), encoding="utf-8")

    def action(name):
        args = [shutil.which("node"), str(ROOT / "runner/cli.mjs"), name,
                "--cwd", str(app), "--owner", owner, "--module", "backend"]
        if name == "start":
            args += ["--config", str(config)]
        result = subprocess.run(args, capture_output=True, text=True, timeout=15)
        assert result.returncode == 0, result.stderr
        reply = json.loads(result.stdout)
        assert reply["ok"], reply
        return reply["jobs"]["backend"]

    job = action("start")
    requested = False
    try:
        deadline = time.monotonic() + 25
        while job["status"] in ("preparing", "running") and time.monotonic() < deadline:
            time.sleep(0.1)
            job = action("status")
            if cancel and job["resolved"] >= 1 and not requested:
                action("cancel")
                requested = True
        assert job["status"] == ("cancelled" if cancel else "failed"), job
        if cancel:
            assert requested and job["resolved"] == 1 and job["total"] is None, job
            assert not job["totalStable"], job
        else:
            assert (job["passed"], job["failed"], job["skipped"], job["total"], job["exitCode"]) == (1, 2, 1, 4, 1), job
        print("collector-" + ("cancel" if cancel else "outcomes") + ": OK", flush=True)
    finally:
        if job["status"] in ("preparing", "running"):
            action("cancel")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ruby", default="ruby")
    options = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="test-progress-rails-") as temporary:
        app = Path(temporary) / "app with spaces"
        app.mkdir()
        fixture(app)
        result, events = check(options.ruby, app, "outcomes",
                               ["test", "test/models/outcomes_test.rb"], [1, 2, 1], 1)
        assert "native test output" in result.stdout
        assert "intentional fixture error" in result.stdout
        assert events[-1]["total"] == 4 and events[-1]["totalStable"]
        check(options.ruby, app, "name-filter",
              ["test", "test/models/outcomes_test.rb", "-n", "test_a_pass"], [1, 0, 0], 0)
        check(options.ruby, app, "bundle-boot-selection",
              ["test", "test/models/outcomes_test.rb", "-n", "test_a_pass"], [1, 0, 0], 0,
              {"FIXTURE_CLEAN_BOOT": "1"})
        write(app, "test/minitest/fixture_plugin.rb", '''module Minitest
  def self.plugin_fixture_options(parser, options)
    parser.on("--fixture-flag") { options[:fixture_flag] = true }
  end
  def self.plugin_fixture_init(options)
    puts "native fixture plugin enabled" if options[:fixture_flag]
  end
end
''')
        result, unused = check(options.ruby, app, "native-plugin-discovery",
                               ["test", "test/models/outcomes_test.rb", "-n", "test_a_pass", "--fixture-flag"],
                               [1, 0, 0], 0)
        assert "native fixture plugin enabled" in result.stdout
        check(options.ruby, app, "no-plugin-discovery",
              ["test", "test/integration/welcome_test.rb", "--no-plugins"], None, 0)
        check(options.ruby, app, "line-filter",
              ["test", "test/models/outcomes_test.rb:3"], [1, 0, 0], 0)
        unused, events = check(options.ruby, app, "fail-fast",
                               ["test", "test/models/outcomes_test.rb", "--fail-fast"], [1, 1, 0], 1)
        assert events[-1]["total"] is None and not events[-1]["totalStable"], events
        check(options.ruby, app, "controller-and-view",
              ["test", "test/integration/welcome_test.rb"], [1, 0, 0], 0)
        check(options.ruby, app, "system-rack-test", ["test:system"], [1, 0, 0], 0)
        check(options.ruby, app, "test-all", ["test:all"], [3, 2, 1], 1)
        for parallel in ("processes", "threads"):
            check(options.ruby, app, "parallel-" + parallel,
                  ["test", "test/models/outcomes_test.rb"], [1, 2, 1], 1,
                  {"FIXTURE_PARALLEL": parallel})
        check(options.ruby, app, "empty-filter",
              ["test", "test/models/outcomes_test.rb", "-n", "test_missing"], [0, 0, 0], None)
        write(app, "test/models/capture_test.rb", '''require "test_helper"
class CaptureTest < ActiveSupport::TestCase
  def test_capture
    out, err = capture_subprocess_io { puts "captured fixture output" }
    assert_equal "captured fixture output\\n", out
  end
end
''')
        result, unused = check(options.ruby, app, "capture",
                               ["test", "test/models/capture_test.rb"], [1, 0, 0], 0)
        assert "captured fixture output" not in result.stdout
        write(app, "test/models/random_test.rb", '''require "test_helper"
class RandomTest < ActiveSupport::TestCase
  def self.test_order; :random; end
  12.times do |number|
    define_method("test_random_#{number}") do
      puts "ORDER:#{number}"
      assert true
    end
  end
end
''')
        args = ["test", "test/models/random_test.rb", "--seed", "9123"]
        native, unused = run(options.ruby, app, args, adapted=False)
        result, unused = check(options.ruby, app, "seed-order", args, [12, 0, 0], 0)
        def order(output):
            return [line.split("ORDER:", 1)[1] for line in output.splitlines() if "ORDER:" in line]
        assert order(native.stdout) == order(result.stdout), (native.stdout, result.stdout)
        write(app, "test/models/slow_test.rb", '''require "test_helper"
class SlowTest < ActiveSupport::TestCase
  def test_a_fast; assert true; end
  def test_b_slow; sleep 60; assert true; end
end
''')
        collector(options.ruby, app)
        collector(options.ruby, app, cancel=True)
        write(app, "test/models/interrupted_test.rb", '''require "test_helper"
class InterruptedTest < ActiveSupport::TestCase
  def test_interrupt; raise Interrupt; end
end
''')
        unused, events = check(options.ruby, app, "interrupt",
                               ["test", "test/models/interrupted_test.rb"], [0, 0, 0], None)
        assert events[-1]["total"] is None and not events[-1]["totalStable"]
        write(app, "test/models/teardown_test.rb", '''require "test_helper"
class TeardownTest < ActiveSupport::TestCase
  def test_skip; skip "skip before teardown"; end
  def teardown; raise "intentional teardown error"; end
end
''')
        check(options.ruby, app, "skip-with-teardown-error",
              ["test", "test/models/teardown_test.rb"], [0, 1, 0], None)
        write(app, "test/models/broken_test.rb", 'raise "intentional load failure"\n')
        unused, events = check(options.ruby, app, "load-error",
                               ["test", "test/models/broken_test.rb"], [0, 0, 0], 1)
        assert events[-1]["total"] is None and not events[-1]["totalStable"]
        write(app, "config/boot.rb", 'raise "intentional boot failure"\n')
        unused, events = check(options.ruby, app, "boot-error", ["test"], [0, 0, 0], 1)
        assert events[-1]["total"] is None and not events[-1]["totalStable"]


if __name__ == "__main__":
    main()
