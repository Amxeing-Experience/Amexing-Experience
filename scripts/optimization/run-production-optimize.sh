#!/usr/bin/expect -f
# Script to run production optimization with confirmations
# Created by Denisse Maldonado

# Default limit if not provided
set limit [lindex $argv 0]
if {$limit == ""} {
    set limit 30
}

puts "Running production optimization for $limit images..."
puts ""

spawn node scripts/optimize-production-vehicle-images.js --limit=$limit

expect "Type \"yes\" to proceed:"
send "yes\r"

expect "Type \"OPTIMIZE PRODUCTION\" to proceed:"
send "OPTIMIZE PRODUCTION\r"

expect eof

puts "\n✅ Optimization complete!"