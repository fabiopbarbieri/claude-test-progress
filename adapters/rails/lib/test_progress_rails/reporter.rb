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
    # Register explicitly: opt-in reporting also works with --no-plugins. This
    # does not re-enable the runner's discovery of any other Minitest plugins.
    Minitest.define_singleton_method(:plugin_test_progress_rails_init) do |_options|
      # Rails' fail-fast reporter raises Interrupt from record. Put our additive
      # reporter first so the triggering failure is counted before that raise.
      reporter.reporters.unshift(TestProgressRails::Reporter.new(progress))
    end
    Minitest.extensions.unshift("test_progress_rails")
  end
end
