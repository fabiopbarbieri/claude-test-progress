# frozen_string_literal: true

module TestProgressRails
  class Reporter < Minitest::AbstractReporter
    def initialize(progress)
      super()
      @progress = progress
    end

    def start
      @progress.start_run
    end

    def record(result)
      @progress.record(result)
    end

    def report
      @progress.report
    end
  end

  def self.install(progress)
    # Minitest 5.20 skips plugin discovery if extensions is pre-populated.
    # Attach only after native initialization, without changing that registry
    # or discovery timing. Explicit instrumentation also works with --no-plugins.
    installation = Module.new do
      define_method(:init_plugins) do |options|
        super(options)
        # Rails' fail-fast reporter raises Interrupt from record. Put ours first
        # so the triggering failure is counted before that raise.
        reporter.reporters.unshift(TestProgressRails::Reporter.new(progress))
      end
    end
    Minitest.singleton_class.prepend(installation)
  end
end
