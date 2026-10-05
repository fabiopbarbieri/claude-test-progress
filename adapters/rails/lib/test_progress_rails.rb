# frozen_string_literal: true

module TestProgressRails
  class Progress
    def initialize
      @pid = Process.pid
      # Core Ruby entropy leaves the test seed and the app's gem activation alone.
      @scope = "rails:#{Random.urandom(16).unpack1('H*')}"
      # Keep protocol lines outside capture_io and temporary fd 1 redirections.
      @stream = $stdout.dup
      @stream.close_on_exec = true
      @stream.sync = true
      @lock = Mutex.new
      @passed = @failed = @skipped = 0
      @reported = @interrupted = @finished = false
      # Minitest catches Interrupt and still calls Reporter#report. Observe the
      # exception without changing its rescue, signal handlers or native exit.
      @interrupt_trace = TracePoint.new(:raise) do |event|
        @interrupted = true if owner? && event.raised_exception.is_a?(Interrupt)
      end
      @interrupt_trace.enable
    end

    def owner?
      Process.pid == @pid
    end

    def start_loading
      snapshot("collecting")
    end

    def start_run
      return unless owner?

      @lock.synchronize do
        @reported = false
        emit("executing")
      end
    end

    def record(result)
      return unless owner?

      @lock.synchronize do
        # A skipped body can still fail in teardown. Count the whole test as a
        # failure if any recorded exception is not a Minitest::Skip.
        if result.failures.any? { |failure| !failure.is_a?(Minitest::Skip) }
          @failed += 1
        elsif result.skipped?
          @skipped += 1
        else
          @passed += 1
        end
        emit("executing")
      end
    end

    def report
      return unless owner?

      @lock.synchronize { @reported = true }
    end

    def finish(exception)
      return unless owner?

      @interrupt_trace.disable
      @lock.synchronize do
        return if @finished

        @finished = true
        # A failing suite exits with SystemExit too; completion is independent
        # of success. Boot/load failures and interrupted runs have no known plan.
        complete = @reported && !@interrupted &&
          (exception.nil? || exception.is_a?(SystemExit))
        emit("finished", final: true, complete: complete)
        @stream.close unless @stream.closed?
      end
    end

    private

    def snapshot(phase)
      return unless owner?

      @lock.synchronize { emit(phase) }
    end

    def emit(phase, final: false, complete: false)
      return if @output_disabled

      resolved = @passed + @failed + @skipped
      # Fixed schema and internally generated strings only. Avoid requiring
      # default gems before config/boot.rb selects the app's locked versions.
      event = %({"scope":"#{@scope}","total":#{complete ? resolved : 'null'},) +
        %("resolved":#{resolved},"passed":#{@passed},"failed":#{@failed},) +
        %("skipped":#{@skipped},"final":#{final},"totalStable":#{complete},"phase":"#{phase}"})
      # A newline separates protocol output from native progress dots.
      @stream.write("\n@@TEST_PROGRESS@@#{event}\n")
      @stream.flush
    rescue IOError, SystemCallError
      # Reporting failure must not change the project's test outcome.
      @output_disabled = true
    end
  end
end
