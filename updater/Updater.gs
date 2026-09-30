/**
 * SAPA Updater
 * Mengambil kode terbaru dari GitHub (fakhirmr/sapa-pajak, folder apps-script/)
 * lalu memasangnya ke project Apps Script SAPA PAJAK dan memperbarui kedua web app.
 *
 * Cara pakai: pilih fungsi "perbarui" di atas, lalu klik Run.
 * Hasilnya bisa dilihat di Execution log (bagian bawah editor).
 */

var SAPA_SCRIPT_ID = '1XOMe2CjXcM0UB6m6jnIv-R33pO5aVAfcXFkPerliOlJFiFnP0rZRRMFa';
var GITHUB_REPO = 'fakhirmr/sapa-pajak';
var GITHUB_BRANCH = 'main';

var FILES = [
  { name: 'Code', type: 'SERVER_JS', path: 'apps-script/Code.gs' },
  { name: 'Index', type: 'HTML', path: 'apps-script/Index.html' },
  { name: 'Publik', type: 'HTML', path: 'apps-script/Publik.html' },
  { name: 'appsscript', type: 'JSON', path: 'apps-script/appsscript.json' }
];

function perbarui() {
  var commit = ambilCommit_();
  Logger.log('Kode GitHub: ' + commit.sha.slice(0, 7) + ' - ' + commit.message.split('\n')[0]);

  var files = FILES.map(function (f) { return { name: f.name, type: f.type, source: ambilFile_(f.path, commit.sha) }; });
  var code = files[0].source;
  if (code.indexOf('function doGet') < 0) throw new Error('Code.gs dari GitHub tidak lengkap. Pembaruan dibatalkan.');
  var manifest = JSON.parse(files[3].source);

  // Kelompokkan deployment web app menurut cara menjalankannya:
  // petugas = "User accessing", publik = "Me" (USER_DEPLOYING).
  var deps = api_('get', '/deployments').deployments || [];
  var groups = {};
  deps.forEach(function (d) {
    if (!d.deploymentConfig || !d.deploymentConfig.versionNumber) return; // lewati "Head"
    var web = (d.entryPoints || []).filter(function (e) { return e.entryPointType === 'WEB_APP'; })[0];
    if (!web) return;
    var cfg = web.webApp.entryPointConfig || {};
    var key = (cfg.executeAs || 'USER_DEPLOYING') + '|' + (cfg.access || 'MYSELF');
    (groups[key] = groups[key] || { executeAs: cfg.executeAs, access: cfg.access, list: [] }).list.push(d);
  });

  var keys = Object.keys(groups);
  if (!keys.length) {
    pasang_(files, manifest, null);
    Logger.log('Kode terpasang. Belum ada deployment web app, jadi buat deployment di project SAPA PAJAK (Deploy -> New deployment).');
    return;
  }
  // Setiap kelompok mendapat versi sendiri, karena pengaturan web app ikut tersimpan di versi.
  keys.forEach(function (k) {
    var g = groups[k];
    pasang_(files, manifest, { executeAs: g.executeAs, access: g.access });
    var v = api_('post', '/versions', { description: 'GitHub ' + commit.sha.slice(0, 7) });
    g.list.forEach(function (d) {
      api_('put', '/deployments/' + d.deploymentId, {
        deploymentConfig: { scriptId: SAPA_SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript',
          description: d.deploymentConfig.description || '' }
      });
      Logger.log('Web app "' + (d.deploymentConfig.description || d.deploymentId) + '" (' + g.executeAs + ', ' + g.access +
        ') -> versi ' + v.versionNumber);
    });
  });
  Logger.log('Selesai. URL web app tidak berubah; muat ulang halamannya untuk melihat versi baru.');
}

function pasang_(files, manifest, webapp) {
  var m = JSON.parse(JSON.stringify(manifest));
  if (webapp) m.webapp = webapp;
  var body = { files: files.map(function (f) { return { name: f.name, type: f.type, source: f.type === 'JSON' ? JSON.stringify(m, null, 2) : f.source }; }) };
  api_('put', '/content', body);
}

function ambilCommit_() {
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + GITHUB_REPO + '/commits/' + GITHUB_BRANCH,
    { headers: { Accept: 'application/vnd.github+json' }, muteHttpExceptions: true });
  if (r.getResponseCode() === 404) throw new Error('Repo ' + GITHUB_REPO + ' tidak bisa dibaca. Pastikan repo sudah Public.');
  if (r.getResponseCode() !== 200) throw new Error('GitHub menjawab ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  var j = JSON.parse(r.getContentText());
  return { sha: j.sha, message: j.commit.message };
}

function ambilFile_(path, sha) {
  var r = UrlFetchApp.fetch('https://raw.githubusercontent.com/' + GITHUB_REPO + '/' + sha + '/' + path, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Gagal mengambil ' + path + ' dari GitHub (' + r.getResponseCode() + ').');
  return r.getContentText();
}

function api_(method, path, payload) {
  var opt = { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (payload) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(payload); }
  var r = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + SAPA_SCRIPT_ID + path, opt);
  var t = r.getContentText();
  if (r.getResponseCode() >= 300) {
    if (/has not been used|is disabled|SERVICE_DISABLED/i.test(t))
      throw new Error('Apps Script API belum aktif. Nyalakan di https://script.google.com/home/usersettings lalu coba lagi.');
    throw new Error('Apps Script API ' + r.getResponseCode() + ' pada ' + path + ': ' + t.slice(0, 300));
  }
  return t ? JSON.parse(t) : {};
}
