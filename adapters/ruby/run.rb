#!/usr/bin/env ruby
# frozen_string_literal: true

if ARGV.empty? || %w[-h --help].include?(ARGV.first)
  puts 'Uso: bundle exec ruby /caminho/adapters/ruby/run.rb rspec [argumentos RSpec]'
  exit(ARGV.empty? ? 2 : 0)
end
unless ARGV.shift == 'rspec'
  warn 'test-progress: runner esperado: rspec'
  exit 2
end

require_relative 'rspec_progress'
TestProgress.rspec_progress = TestProgress::RSpecProgress.new
begin
  begin
    require 'rspec/core'
  rescue LoadError
    warn 'test-progress: RSpec indisponível; use o Ruby/bundle do projeto com rspec-core 3.13.x.'
    exit 2
  end
  unless RSpec::Core::Version::STRING.start_with?('3.13.')
    warn 'test-progress: este adaptador requer rspec-core 3.13.x.'
    exit 2
  end

  # Native RSpec uses this basename for its default spec/ selection.
  $PROGRAM_NAME = Gem.bin_path('rspec-core', 'rspec')
  ARGV.unshift('--require', File.expand_path('rspec_listener.rb', __dir__))
  RSpec::Core::Runner.invoke
ensure
  TestProgress.rspec_progress.finish
end
