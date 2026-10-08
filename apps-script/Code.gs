/**
 * Offer Sheet Maker – history saver (Google Apps Script web app)
 * Saves every downloaded offer sheet into a Drive folder and lists past ones.
 * Deploy: Execute as = Me, Who has access = Anyone. (Every request is checked:
 * caller must be signed in to the site with an @usawholesalesupplies.com account.)
 */
const FOLDER_ID = '1-w_ILH5ov9pTzKYbR4YKqTJcH3-tMJh5';
const O2I_URL   = 'https://chebtjqheqnrnjgbixza.supabase.co';
const DOMAIN    = '@usawholesalesupplies.com';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    const email = verifyUser_(req.token, req.key);
    if (!email) return out_({ ok: false, error: 'Not signed in with a company account' });

    const folder = DriveApp.getFolderById(FOLDER_ID);

    if (req.action === 'save') {
      const bytes = Utilities.base64Decode(String(req.b64 || ''));
      if (!bytes.length || bytes.length > MAX_BYTES) return out_({ ok: false, error: 'Bad file size' });
      const tz = Session.getScriptTimeZone();
      const stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd_HHmm');
      const who = email.split('@')[0];
      const base = String(req.base || 'Offer_Sheet').replace(/[^A-Za-z0-9_-]/g, '');
      const name = base + '_Offer_Sheet_' + stamp + '_' + who + '.xlsx';
      const file = folder.createFile(Utilities.newBlob(bytes,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name));
      const m = req.meta || {};
      file.setDescription(JSON.stringify({
        by: email, rows: m.rows, stores: m.stores, total: m.total,
        codes: (m.codes || []).slice(0, 2000)
      }));
      return out_({ ok: true, name: name, id: file.getId(), url: file.getUrl() });
    }

    if (req.action === 'list') {
      const files = [];
      const it = folder.getFiles();
      while (it.hasNext()) {
        const f = it.next();
        let meta = {};
        try { meta = JSON.parse(f.getDescription() || '{}'); } catch (x) {}
        files.push({ id: f.getId(), name: f.getName(), created: f.getDateCreated().toISOString(),
                     url: f.getUrl(), by: meta.by || '', rows: meta.rows || '', stores: meta.stores || [],
                     total: meta.total || '' });
      }
      files.sort(function (a, b) { return b.created < a.created ? -1 : 1; });
      return out_({ ok: true, files: files.slice(0, Number(req.limit) || 100) });
    }

    return out_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

// Checks the site's login token with o2i's login service; returns the email if it's a company account.
function verifyUser_(token, key) {
  if (!token || !key) return null;
  const r = UrlFetchApp.fetch(O2I_URL + '/auth/v1/user', {
    headers: { apikey: key, Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return null;
  const email = String((JSON.parse(r.getContentText()) || {}).email || '').toLowerCase();
  return email.endsWith(DOMAIN) ? email : null;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run once from the editor to grant permissions and confirm the folder is reachable.
function testSetup() {
  Logger.log('Folder OK: ' + DriveApp.getFolderById(FOLDER_ID).getName());
  Logger.log('o2i reachable: ' + UrlFetchApp.fetch(O2I_URL + '/auth/v1/health', { muteHttpExceptions: true }).getResponseCode());
}
