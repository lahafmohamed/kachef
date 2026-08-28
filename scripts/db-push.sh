#!/usr/bin/env bash
#
# Base LOCALE  ->  VPS.  Écrase les données de production.
#
# La base tourne en WAL : les écritures récentes vivent dans scout.db-wal et ne sont
# pas encore dans scout.db. Copier scout.db seul les perdrait, donc on passe par un
# instantané cohérent (API backup de SQLite) qui replie le WAL dedans.
#
# Usage: scripts/db-push.sh [--yes]
set -euo pipefail

VPS=root@169.58.210.77
REMOTE_DB=/var/lib/kachef/scout.db
REMOTE_BACKUPS=/var/lib/kachef/backups
SERVICE=kachef
DOMAIN=kachef.nolyxci.com

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DB="$ROOT/server/scout.db"
STAMP=$(date +%Y%m%d-%H%M%S)
SNAP="$ROOT/server/scout.db.push-$STAMP"

[ -f "$LOCAL_DB" ] || { echo "Base locale introuvable : $LOCAL_DB"; exit 1; }

# ---------- ce qui va partir ----------
echo "Base locale : $LOCAL_DB"
node -e '
const D = require("better-sqlite3");
const db = new D(process.argv[1], { readonly: true });
const n = (t) => { try { return db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; } catch { return "-"; } };
console.log(`  ${n("members")} membres · ${n("sessions")} séances · ${n("leaders")} chefs · ${n("attendance")} présences · ${n("users")} comptes`);
' "$LOCAL_DB"

echo
echo "Base distante ACTUELLE ($VPS) :"
ssh -o BatchMode=yes "$VPS" "cd /opt/kachef && node -e '
const D = require(\"better-sqlite3\");
const db = new D(\"$REMOTE_DB\", { readonly: true });
const n = (t) => { try { return db.prepare(\`SELECT COUNT(*) n FROM \${t}\`).get().n; } catch { return \"-\"; } };
console.log(\`  \${n(\"members\")} membres · \${n(\"sessions\")} séances · \${n(\"leaders\")} chefs · \${n(\"attendance\")} présences · \${n(\"users\")} comptes\`);
'" || echo "  (pas de base distante lisible)"

echo
echo "⚠  La base distante ci-dessus sera REMPLACÉE par la base locale."
echo "   Une copie horodatée est gardée dans $REMOTE_BACKUPS avant l'écrasement."
if [ "${1:-}" != "--yes" ]; then
  read -r -p "Taper 'oui' pour continuer : " ok
  [ "$ok" = "oui" ] || { echo "Annulé."; exit 1; }
fi

# ---------- instantané local ----------
echo
echo "=== 1/5 instantané local ==="
rm -f "$SNAP"
node -e '
const D = require("better-sqlite3");
const db = new D(process.argv[1], { readonly: true });
db.backup(process.argv[2]).then(() => { db.close(); console.log("  instantané pris (WAL replié)"); })
  .catch((e) => { console.error(e.message); process.exit(1); });
' "$LOCAL_DB" "$SNAP"

# ---------- envoi ----------
echo "=== 2/5 envoi ==="
scp -o BatchMode=yes -q "$SNAP" "$VPS:/tmp/kachef-push-$STAMP.db"
echo "  $(du -h "$SNAP" | cut -f1) envoyés"

# ---------- bascule côté serveur ----------
echo "=== 3/5 sauvegarde distante + bascule ==="
ssh -o BatchMode=yes "$VPS" "set -e
  install -d -m 750 '$REMOTE_BACKUPS'
  if [ -f '$REMOTE_DB' ]; then
    # Instantané de l'existant aussi : copier le fichier brut laisserait son WAL derrière
    cd /opt/kachef && node -e '
      const D = require(\"better-sqlite3\");
      const db = new D(\"$REMOTE_DB\", { readonly: true });
      db.backup(\"$REMOTE_BACKUPS/scout-avant-$STAMP.db\").then(() => db.close());
    '
    echo \"  sauvegarde : $REMOTE_BACKUPS/scout-avant-$STAMP.db\"
  fi
  systemctl stop $SERVICE
  # Le WAL et le SHM appartiennent à l'ANCIENNE base : les laisser corromprait la nouvelle
  rm -f '$REMOTE_DB' '$REMOTE_DB-wal' '$REMOTE_DB-shm'
  mv '/tmp/kachef-push-$STAMP.db' '$REMOTE_DB'
  chmod 640 '$REMOTE_DB'
  systemctl start $SERVICE
  # On ne garde que les 20 dernières sauvegardes
  ls -1t '$REMOTE_BACKUPS'/scout-avant-*.db 2>/dev/null | tail -n +21 | xargs -r rm -f
  echo '  service redémarré'
"

# ---------- vérification ----------
echo "=== 4/5 vérification ==="
sleep 2
ssh -o BatchMode=yes "$VPS" "cd /opt/kachef && node -e '
const D = require(\"better-sqlite3\");
const db = new D(\"$REMOTE_DB\", { readonly: true });
const n = (t) => { try { return db.prepare(\`SELECT COUNT(*) n FROM \${t}\`).get().n; } catch { return \"-\"; } };
console.log(\`  distant : \${n(\"members\")} membres · \${n(\"sessions\")} séances · \${n(\"leaders\")} chefs · \${n(\"attendance\")} présences · \${n(\"users\")} comptes\`);
'"

echo "=== 5/5 site ==="
curl -s -o /dev/null -w "  https://$DOMAIN -> HTTP %{http_code}\n" "https://$DOMAIN/"

rm -f "$SNAP"
echo
echo "Terminé. Comparez les deux lignes de comptes ci-dessus : elles doivent être identiques."
