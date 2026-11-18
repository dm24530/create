const { build } = require("./package.json");

module.exports = {
  ...build,
  mac: {
    ...build.mac,
    identity: "-",
    hardenedRuntime: false,
    notarize: false,
  },
};