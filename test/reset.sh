#!/bin/bash
pkill -f fakesb-server.js; sleep 1
cp ../schema.sql /tmp/schema.sql; cp seed.sql /tmp/seed.sql; chmod 644 /tmp/schema.sql /tmp/seed.sql
su postgres -c "psql -q -c 'drop database if exists aw'" ; su postgres -c "psql -q -c 'create database aw'"
su postgres -c "psql -q -d aw -v ON_ERROR_STOP=1 -f /tmp/stub2.sql -f /tmp/schema.sql" 2>&1 | grep -iv notice
su postgres -c "psql -q -d aw -v ON_ERROR_STOP=1 -f /tmp/seed.sql"
su postgres -c "psql -q -d aw -c \"alter user postgres password 'pw'\""
pkill -f fakesb-server.js; true
