#!/usr/bin/env bash
# Concurrency test: 4 different patients race for each of 5 slots at the same instant.
# A database advisory lock acts as a starting gate so all 20 sessions call the booking RPC together.
# Expect exactly one confirmed booking per slot and SLOT_UNAVAILABLE for every loser.
set -euo pipefail
DB="$1"
PSQL=(psql -X -q -At -d "$DB")
OUT=$(mktemp -d)
mapfile -t SLOTS < <("${PSQL[@]}" -c "SELECT id FROM hms.appointment_slots s WHERE starts_at > now() + interval '9 days'
  AND NOT EXISTS (SELECT 1 FROM hms.appointments a WHERE a.slot_id = s.id) ORDER BY starts_at LIMIT 5")
test "${#SLOTS[@]}" -eq 5

"${PSQL[@]}" -c "SELECT pg_advisory_lock(777); SELECT pg_sleep(3); SELECT pg_advisory_unlock(777);" >/dev/null &
GATE=$!
sleep 0.5
n=10
for slot in "${SLOTS[@]}"; do
  for _ in 1 2 3 4; do
    user="c0000000-0000-4000-8000-0000000000$n"
    (
      "${PSQL[@]}" -v ON_ERROR_STOP=1 <<SQL > "$OUT/$n.out" 2>&1 && echo "won $slot" >> "$OUT/$n.out" || true
SELECT pg_advisory_lock_shared(777); SELECT pg_advisory_unlock_shared(777);
BEGIN;
SELECT hms_test.claims('$user', 'aal1');
SET LOCAL ROLE authenticated;
SELECT public.hms_v4_book_self('test-hospital','MAIN','$slot','Race Patient $n','hospital',gen_random_uuid(),'v1',true,50000,2);
COMMIT;
SQL
    ) &
    n=$((n + 1))
  done
done
wait
wins=$(cat "$OUT"/*.out | grep -c '^won ' || true)
losses=$(cat "$OUT"/*.out | grep -c 'SLOT_UNAVAILABLE' || true)
per_slot=$("${PSQL[@]}" -c "SELECT max(c) FROM (SELECT count(*) c FROM hms.appointments WHERE slot_id IN ($(printf "'%s'," "${SLOTS[@]}" | sed 's/,$//')) AND status <> 'cancelled' GROUP BY slot_id) x")
rm -rf "$OUT"
echo "concurrency: wins=$wins losses=$losses max_per_slot=$per_slot"
test "$wins" -eq 5 && test "$losses" -eq 15 && test "$per_slot" -eq 1
echo "ok T10 20 simultaneous bookings for 5 slots -> exactly one booking per slot"
