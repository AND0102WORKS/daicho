#!/bin/bash
pkill -f fakesb-server.js; sleep 1
cd "$(dirname "$0")"
cp ../src/schema.sql /tmp/schema.sql; cp seed.sql /tmp/seed.sql; cp stub.sql /tmp/stub.sql; chmod 644 /tmp/schema.sql /tmp/seed.sql /tmp/stub.sql
service postgresql status >/dev/null || service postgresql start >/dev/null
su postgres -c "psql -q -c 'drop database if exists aw'" ; su postgres -c "psql -q -c 'create database aw'"
su postgres -c "psql -q -d aw -v ON_ERROR_STOP=1 -f /tmp/stub.sql -f /tmp/schema.sql" 2>&1 | grep -iv notice
su postgres -c "psql -q -d aw -v ON_ERROR_STOP=1 -f /tmp/seed.sql"
su postgres -c "psql -q -d aw -c \"alter user postgres password 'pw'\""
pkill -f fakesb-server.js; true
