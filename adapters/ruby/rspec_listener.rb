# frozen_string_literal: true

# Loaded by RSpec after native options (including output streams) are applied.
# Register a listener rather than replacing or selecting a user formatter.
RSpec.configuration.reporter.register_listener(
  TestProgress.rspec_progress, *TestProgress::RSpecProgress::NOTIFICATIONS
)
