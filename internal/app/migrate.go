package app

import (
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/AlexxIT/go2rtc/pkg/creds"
	"gopkg.in/yaml.v3"
)

// AdminPassKey is the vault entry holding the Web UI admin password.
const AdminPassKey = "GO2RTC_ADMIN_PASS"

var sanRe = regexp.MustCompile(`[^A-Z0-9]+`)

func secretNameFor(camName string, used map[string]bool) string {
	base := "PASS_" + strings.Trim(sanRe.ReplaceAllString(strings.ToUpper(camName), "_"), "_")
	if base == "PASS_" {
		base = "PASS_CAM"
	}
	name := base
	for i := 2; used[name]; i++ {
		name = base + "_" + strconv.Itoa(i)
	}
	used[name] = true
	return name
}

// migrateURL moves a plain-text password from a stream URL into the
// encrypted vault and replaces it with a ${NAME} placeholder.
func migrateURL(raw, camName string, used map[string]bool) (string, bool) {
	i := strings.Index(raw, "://")
	if i < 0 {
		return "", false
	}
	rest := raw[i+3:]
	end := strings.IndexAny(rest, "/?#")
	authority := rest
	if end >= 0 {
		authority = rest[:end]
	}
	at := strings.LastIndex(authority, "@")
	if at < 0 {
		return "", false
	}
	userinfo := authority[:at]
	colon := strings.Index(userinfo, ":")
	if colon < 0 {
		return "", false
	}
	pass := userinfo[colon+1:]
	if pass == "" || strings.HasPrefix(pass, "${") {
		return "", false
	}
	decoded := pass
	if u, err := url.Parse(raw); err == nil && u.User != nil {
		if p, ok := u.User.Password(); ok {
			decoded = p
		}
	}
	name := secretNameFor(camName, used)
	if err := VaultSet(name, decoded); err != nil {
		return "", false
	}
	creds.AddSecret(decoded)
	return raw[:i+3] + userinfo[:colon] + ":${" + name + "}" + raw[i+3+at:], true
}

func randomPass(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)[:n]
}

func configDir() string {
	dir := ConfigPath
	if i := strings.LastIndexByte(dir, '/'); i > 0 {
		return dir[:i]
	}
	return "."
}

// migrateSecrets moves plain-text passwords from go2rtc.yaml into the
// encrypted vault and enables Basic auth for the whole Web UI.
// It runs before the config file is parsed, so ${NAME} placeholders are
// resolved from the vault at load time.
func migrateSecrets() {
	if ConfigPath == "" || !VaultEnabled() {
		return
	}
	b, err := os.ReadFile(ConfigPath)
	if err != nil {
		return
	}
	var cfg map[string]any
	if err = yaml.Unmarshal(b, &cfg); err != nil {
		return
	}
	changed := false

	// bootstrap the admin account on first run
	if _, ok := VaultGet(AdminPassKey); !ok {
		pass := randomPass(12)
		if err = VaultSet(AdminPassKey, pass); err == nil {
			receipt := configDir() + "/admin_password.txt"
			_ = os.WriteFile(receipt, []byte("username: admin\npassword: "+pass+"\n"), 0600)
			Logger.Warn().Msgf("[secrets] first run: admin credentials written to %s", receipt)
		}
	}

	used := map[string]bool{}
	if streams, ok := cfg["streams"].(map[string]any); ok {
		for name, v := range streams {
			s, ok := v.(string)
			if !ok {
				continue
			}
			if ns, ok := migrateURL(s, name, used); ok {
				streams[name] = ns
				changed = true
			}
		}
	}

	apiSec, _ := cfg["api"].(map[string]any)
	if apiSec == nil {
		apiSec = map[string]any{}
		cfg["api"] = apiSec
	}
	if _, ok := apiSec["username"]; !ok {
		apiSec["username"] = "admin"
		changed = true
	}
	if _, ok := apiSec["password"]; !ok {
		apiSec["password"] = "${" + AdminPassKey + "}"
		changed = true
	}
	if la, ok := apiSec["local_auth"].(bool); !ok || !la {
		apiSec["local_auth"] = true
		changed = true
	}

	if !changed {
		return
	}
	out, err := yaml.Marshal(cfg)
	if err != nil {
		return
	}
	if err = os.WriteFile(ConfigPath, out, 0600); err != nil {
		Logger.Error().Err(err).Msg("[secrets] write migrated config")
		return
	}
	Logger.Info().Msg("[secrets] config migrated: passwords encrypted in vault, auth enabled")
}
