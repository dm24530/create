package updater

import "testing"

func TestCompareVersion(t *testing.T) {
	if compareVersion("0.2.0", "0.1.9") <= 0 {
		t.Fatal("expected 0.2.0 to be newer")
	}
	if compareVersion("1.0.0", "1.0.0") != 0 {
		t.Fatal("expected equal versions")
	}
	if compareVersion("0.1.0-beta", "0.1.0") != 0 {
		t.Fatal("expected prerelease suffix to compare as the base version")
	}
}

func TestParseChecksum(t *testing.T) {
	value := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  create-local.exe"
	checksum, err := parseChecksum([]byte(value))
	if err != nil {
		t.Fatal(err)
	}
	if checksum != "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" {
		t.Fatalf("unexpected checksum: %s", checksum)
	}
}

func TestResolveAssetURL(t *testing.T) {
	value, err := resolveAssetURL("/api/v1/public/local-client/create-local.exe")
	if err != nil {
		t.Fatal(err)
	}
	if value != "https://create.superai.sbs/api/v1/public/local-client/create-local.exe" {
		t.Fatalf("unexpected URL: %s", value)
	}
	if _, err := resolveAssetURL("http://example.com/create-local.exe"); err == nil {
		t.Fatal("expected insecure URL to fail")
	}
}
