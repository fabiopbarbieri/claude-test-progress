#!/usr/bin/env ruby
# frozen_string_literal: true

# Invoke with the Ruby/Bundler environment of the Rails application, from its root.
commands = %w[test test:system test:all].freeze
if ARGV.empty? || %w[-h --help].include?(ARGV.first)
  puts "Uso: bundle exec ruby /caminho/adapters/rails/run.rb {test|test:system|test:all} [argumentos]"
  exit(ARGV.empty? ? 2 : 0)
end
unless commands.include?(ARGV.first)
  warn "test-progress: comando esperado: test, test:system ou test:all"
  exit 2
end

require_relative "lib/test_progress_rails"
progress = TestProgressRails::Progress.new
# Register before Rails/Minitest autorun so this runs after their exit hooks.
at_exit { progress.finish($!) }
progress.start_loading

rails = File.expand_path("bin/rails", Dir.pwd)
boot = File.expand_path("config/boot.rb", Dir.pwd)
unless File.file?(rails) && File.file?(boot)
  warn "test-progress: execute na raiz de um app Rails com bin/rails e config/boot.rb"
  exit 2
end

# Let the application's boot select its locked gems before loading Minitest.
# Standard bin/rails requires the same boot file, which Ruby loads only once.
require boot
require "minitest"
version = Gem::Version.new(Minitest::VERSION)
unless version >= Gem::Version.new("5.20") && version < Gem::Version.new("6")
  warn "test-progress: Minitest >= 5.20 e < 6 é necessário no ambiente do app"
  exit 2
end

require_relative "lib/test_progress_rails/reporter"
TestProgressRails.install(progress)
# Keep ARGV, cwd, environment, logs and exit handling with Rails itself.
load rails
