# frozen_string_literal: true

require 'json'
require 'securerandom'

module TestProgress
  # Owns only progress output. RSpec keeps its configured formatters and streams.
  class RSpecProgress
    NOTIFICATIONS = %i[start example_passed example_failed example_pending dump_summary].freeze

    def initialize
      @stream = STDOUT.dup
      @stream.close_on_exec = true
      @stream.sync = true
      @pid = Process.pid
      @scope = "rspec:#{SecureRandom.uuid}"
      @total = nil
      @results = {}
      @counts = { passed: 0, failed: 0, skipped: 0 }
      @summary = false
      @outside_errors = false
      snapshot(phase: 'collecting')
    end

    def start(notification)
      # Discovery failures can cause RSpec to announce zero without a full plan.
      @total = notification.count unless RSpec.world.non_example_failure
      snapshot
    end

    def example_passed(notification)
      record(notification, :passed)
    end

    def example_failed(notification)
      record(notification, :failed)
    end

    def example_pending(notification)
      record(notification, :skipped)
    end

    def dump_summary(notification)
      @summary = true
      @outside_errors = notification.errors_outside_of_examples_count.positive?
    end

    def finish
      dry_run = defined?(RSpec) && RSpec.configuration.dry_run
      complete = @summary && !@outside_errors && !@total.nil? &&
                 (dry_run || @results.length == @total)
      snapshot(final: true, stable: complete, phase: dry_run ? 'collected' : 'finished')
    ensure
      @stream.close
    end

    private

    def record(notification, outcome)
      return if RSpec.configuration.dry_run

      # Retry extensions must report one final result per example; replacement
      # also avoids counting repeat outcome notifications twice.
      key = notification.example.id
      previous = @results[key]
      @counts[previous] -= 1 if previous
      @results[key] = outcome
      @counts[outcome] += 1
      @total = nil if @total && @results.length > @total
      snapshot
    end

    def snapshot(final: false, stable: !@total.nil?, phase: 'executing')
      # A fork must never publish a copy of the parent's cumulative counters.
      return unless Process.pid == @pid

      event = { scope: @scope, total: @total, resolved: @counts.values.sum,
                passed: @counts[:passed], failed: @counts[:failed], skipped: @counts[:skipped],
                final: final, totalStable: stable, phase: phase }
      @stream.write("\n@@TEST_PROGRESS@@#{JSON.generate(event)}\n")
    end
  end

  class << self
    attr_accessor :rspec_progress
  end
end
