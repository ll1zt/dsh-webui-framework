/* eslint-disable no-undef */
window.__ModuleLoader__.load({ id: "@lllzt/dsh-web-ui", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var session = require("@deepseek-ai/dsh-client-ui-session");
function apply() {
  return session;
}
exports.apply = apply;
return module.exports; } });
