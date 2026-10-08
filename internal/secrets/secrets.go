package secrets

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/AlexxIT/go2rtc/internal/api"
	"github.com/AlexxIT/go2rtc/internal/app"
	"github.com/AlexxIT/go2rtc/pkg/creds"
	"github.com/rs/zerolog"
	"gopkg.in/yaml.v3"
)

var log zerolog.Logger

// AdminPassKey is the vault entry holding the Web UI admin password.
const AdminPassKey = "GO2RTC_ADMIN_PASS"

func Init() {
	log = app.GetLogger("secrets")
	migrateConfig()
	api.HandleFunc("api/secrets", secretsHandler)
}

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
	if err := app.VaultSet(name, decoded); err != nil {
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
	dir := app.ConfigPath
	if i := strings.LastIndexByte(dir, '/'); i > 0 {
		return dir[:i]
	}
	return "."
}

// migrateConfig moves plain-text passwords from go2rtc.yaml into the
// encrypted vault and enables Basic auth for the whole Web UI.
func migrateConfig() {
	if app.ConfigPath == "" || !app.VaultEnabled() {
		return
	}
	b, err := os.ReadFile(app.ConfigPath)
	if err != nil {
		return
	}
	var cfg map[string]any
	if err = yaml.Unmarshal(b, &cfg); err != nil {
		return
	}
	changed := false

	// bootstrap the admin account on first run
	if _, ok := app.VaultGet(AdminPassKey); !ok {
		pass := randomPass(12)
		if err = app.VaultSet(AdminPassKey, pass); err == nil {
			receipt := configDir() + "/admin_password.txt"
			_ = os.WriteFile(receipt, []byte("username: admin\npassword: "+pass+"\n"), 0600)
			log.Warn().Msgf("[secrets] first run: admin credentials written to %s", receipt)
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
	if err = os.WriteFile(app.ConfigPath, out, 0600); err != nil {
		log.Error().Err(err).Msg("[secrets] write migrated config")
		return
	}
	log.Info().Msg("[secrets] config migrated: passwords encrypted in vault, auth enabled (restart to apply)")
}

type secretItem struct {
	Name    string `json:"name"`
	Masked  string `json:"masked"`
	IsAdmin bool   `json:"is_admin"`
}

func secretsHandler(w http.ResponseWriter, r *http.Request) {
	if !app.VaultEnabled() {
		http.Error(w, "secrets vault disabled", http.StatusNotImplemented)
		return
	}
	q := r.URL.Query()
	name := q.Get("name")

	switch r.Method {
	case http.MethodGet:
		if name != "" {
			if q.Get("reveal") != "1" {
				http.Error(w, "reveal=1 required", http.StatusBadRequest)
				return
			}
			value, ok := app.VaultGet(name)
			if !ok {
				http.Error(w, "secret not found", http.StatusNotFound)
				return
			}
			api.ResponseJSON(w, map[string]string{"name": name, "value": value})
			return
		}
		names := app.VaultNames()
		list := make([]secretItem, 0, len(names))
		for _, n := range names {
			list = append(list, secretItem{Name: n, Masked: "********", IsAdmin: n == AdminPassKey})
		}
		api.ResponseJSON(w, map[string]any{"enabled": true, "secrets": list})

	case http.MethodPost:
		var req struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Value == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if req.Name == "" {
			existing := map[string]bool{}
			for _, n := range app.VaultNames() {
				existing[n] = true
			}
			req.Name = secretNameFor("CAM "+randomPass(4), existing)
		}
		if err := app.VaultSet(req.Name, req.Value); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		creds.AddSecret(req.Value)
		if req.Name == app.AdminPassKey {
			receipt := configDir() + "/admin_password.txt"
			_ = os.WriteFile(receipt, []byte("username: admin\npassword: "+req.Value+"\n"), 0600)
			log.Warn().Msgf("[secrets] admin password changed; receipt updated: %s", receipt)
		}
		api.ResponseJSON(w, map[string]string{"name": req.Name, "ref": "${" + req.Name + "}"})

	case http.MethodDelete:
		if name == "" {
			http.Error(w, "name required", http.StatusBadRequest)
			return
		}
		if name == AdminPassKey {
			http.Error(w, "admin password cannot be deleted", http.StatusForbidden)
			return
		}
		if err := app.VaultDelete(name); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		api.ResponseJSON(w, map[string]string{"ok": name})

	default:
		http.Error(w, "", http.StatusMethodNotAllowed)
	}
}
