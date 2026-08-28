#!/usr/bin/env bash
#
# VPS  ->  base LOCALE.  Écrase la base locale.
#
# Le service distant n'est PAS arrêté : l'instantané est pris par l'API backup de
# SQLite, qui donne une copie cohérente d'une base en cours d'écriture. Les chefs
# peuvent continuer à saisir pendant la récupération.
#
# Usage: scripts/db-pull.sh [--yes]
set -euo pipefail

VPS=root@169.58.210.77
REMOTE_DB=/var/lib/kachef/scout.db

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DB="$ROOT/server/scout.db"
STAMP=$(date +%Y%m%d-%H%M%S)

# ---------- ce qui va arriver ----------
echo "Base distante ($VPS) :"
ssh -o BatchMode=yes "$VPS" "cd /opt/kachef && node -e '
const D = require(\"better-sqlite3\");
const db = new D(\"$REMOTE_DB\", { readonly: true });
const n = (t) => { try { return db.prepare(\`SELECT COUNT(*) n FROM \${t}\`).get().n; } catch { return \"-\"; } };
console.log(\`  \${n(\"members\")} membres · \${n(\"sessions\")} séances · \${n(\"leaders\")} chefs · \${n(\"attendance\")} présences · \${n(\"users\")} comptes\`);
'"

echo
if [ -f "$LOCAL_DB" ]; then
  echo "Base locale ACTUELLE :"
  node -e '
const D = require("better-sqlite3");
const db = new D(process.argv[1], { readonly: true });
const n = (t) => { try { return db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; } catch { return "-"; } };
console.log(`  ${n("members")} membres · ${n("sessions")} séances · ${n("leaders")} chefs · ${n("attendance")} présences · ${n("users")} comptes`);
' "$LOCAL_DB"
  echo
  echo "⚠  La base locale ci-dessus sera REMPLACÉE par la base distante."
  echo "   Une copie horodatée est gardée dans server/ avant l'écrasement."
else
  echo "Pas de base locale : elle sera créée."
fi

if [ "${1:-}" != "--yes" ]; then
  read -r -p "Taper 'oui' pour continuer : " ok
  [ "$ok" = "oui" ] || { echo "Annulé."; exit 1; }
fi

echo
echo "=== 1/4 instantané distant ==="
ssh -o BatchMode=yes "$VPS" "cd /opt/kachef && node -e '
const D = require(\"better-sqlite3\");
const db = new D(\"$REMOTE_DB\", { readonly: true });
db.backup(\"/tmp/kachef-pull-$STAMP.db\").then(() => { db.close(); console.log(\"  instantané pris (service toujours en ligne)\"); })
  .catch((e) => { console.error(e.message); process.exit(1); });
'"

echo "=== 2/4 récupération ==="
scp -o BatchMode=yes -q "$VPS:/tmp/kachef-pull-$STAMP.db" "$ROOT/server/scout.db.from-vps-$STAMP"
ssh -o BatchMode=yes "$VPS" "rm -f /tmp/kachef-pull-$STAMP.db"
echo "  $(du -h "$ROOT/server/scout.db.from-vps-$STAMP" | cut -f1) récupérés"

echo "=== 3/4 bascule locale ==="
# Le serveur local doit être arrêté : sous Windows le fichier reste verrouillé tant
# qu'un node le tient ouvert, et le déplacement échouerait au milieu.
if [ -f "$LOCAL_DB" ]; then
  cp "$LOCAL_DB" "$ROOT/server/scout.db.local-avant-$STAMP" 2>/dev/null || {
    echo "  Impossible de sauvegarder la base locale — le serveur local tourne encore ?"
    echo "  Arrêtez 'npm run dev' puis relancez ce script."
    exit 1
  }
  echo "  sauvegarde : server/scout.db.local-avant-$STAMP"
fi
# Le WAL et le SHM appartiennent à l'ANCIENNE base locale : les garder corromprait la nouvelle
rm -f "$LOCAL_DB" "$LOCAL_DB-wal" "$LOCAL_DB-shm" 2>/dev/null || {
  echo "  Fichier verrouillé — arrêtez le serveur local ('npm run dev') puis relancez."
  exit 1
}
mv "$ROOT/server/scout.db.from-vps-$STAMP" "$LOCAL_DB"

echo "=== 4/4 vérification ==="
node -e '
const D = require("better-sqlite3");
const db = new D(process.argv[1], { readonly: true });
const n = (t) => { try { return db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; } catch { return "-"; } };
console.log(`  local : ${n("members")} membres · ${n("sessions")} séances · ${n("leaders")} chefs · ${n("attendance")} présences · ${n("users")} comptes`);
' "$LOCAL_DB"

echo
echo "Terminé. Comparez avec la ligne distante du début : elles doivent être identiques."
