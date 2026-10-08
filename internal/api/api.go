package api

import (
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/AlexxIT/go2rtc/internal/app"
	"github.com/AlexxIT/go2rtc/www"
	"github.com/rs/zerolog"
)

func Init() {
	var cfg struct {
		Mod struct {
			Listen     string `yaml:"listen"`
			Username   string `yaml:"username"`
			Password   string `yaml:"password"`
			LocalAuth  bool   `yaml:"local_auth"`
			BasePath   string `yaml:"base_path"`
			StaticDir  string `yaml:"static_dir"`
			Origin     string `yaml:"origin"`
			TLSListen  string `yaml:"tls_listen"`
			TLSCert    string `yaml:"tls_cert"`
			TLSKey     string `yaml:"tls_key"`
			UnixListen string `yaml:"unix_listen"`

			AllowPaths []string `yaml:"allow_paths"`
		} `yaml:"api"`
	}

	// default config
	cfg.Mod.Listen = ":1984"

	// load config from YAML
	app.LoadConfig(&cfg)

	if cfg.Mod.Listen == "" && cfg.Mod.UnixListen == "" && cfg.Mod.TLSListen == "" {
		return
	}

	allowPaths = cfg.Mod.AllowPaths
	basePath = cfg.Mod.BasePath
	log = app.GetLogger("api")

	initStatic(cfg.Mod.StaticDir)

	HandleFunc("api", apiHandler)
	HandleFunc("api/config", configHandler)
	HandleFunc("api/exit", exitHandler)
	HandleFunc("api/restart", restartHandler)
	HandleFunc("api/log", logHandler)

	Handler = http.DefaultServeMux // 4th

	if cfg.Mod.Origin == "*" {
		Handler = middlewareCORS(Handler) // 3rd
	}

	if cfg.Mod.Username != "" {
		Handler = middlewareAuth(cfg.Mod.Username, cfg.Mod.Password, cfg.Mod.LocalAuth, Handler) // 2nd
	}

	if log.Trace().Enabled() {
		Handler = middlewareLog(Handler) // 1st
	}

	if cfg.Mod.Listen != "" {
		_, port, _ := net.SplitHostPort(cfg.Mod.Listen)
		Port, _ = strconv.Atoi(port)
		go listen("tcp", cfg.Mod.Listen)
	}

	if cfg.Mod.UnixListen != "" {
		_ = syscall.Unlink(cfg.Mod.UnixListen)
		go listen("unix", cfg.Mod.UnixListen)
	}

	// Initialize the HTTPS server
	if cfg.Mod.TLSListen != "" && cfg.Mod.TLSCert != "" && cfg.Mod.TLSKey != "" {
		go tlsListen("tcp", cfg.Mod.TLSListen, cfg.Mod.TLSCert, cfg.Mod.TLSKey)
	}
}

func listen(network, address string) {
	ln, err := net.Listen(network, address)
	if err != nil {
		log.Error().Err(err).Msg("[api] listen")
		return
	}

	log.Info().Str("addr", address).Msg("[api] listen")

	server := http.Server{
		Handler:           Handler,
		ReadHeaderTimeout: 5 * time.Second, // Example: Set to 5 seconds
	}
	if err = server.Serve(ln); err != nil {
		log.Fatal().Err(err).Msg("[api] serve")
	}
}

func tlsListen(network, address, certFile, keyFile string) {
	var cert tls.Certificate
	var err error
	if strings.IndexByte(certFile, '\n') < 0 && strings.IndexByte(keyFile, '\n') < 0 {
		// check if file path
		cert, err = tls.LoadX509KeyPair(certFile, keyFile)
	} else {
		// if text file content
		cert, err = tls.X509KeyPair([]byte(certFile), []byte(keyFile))
	}
	if err != nil {
		log.Error().Err(err).Caller().Send()
		return
	}

	ln, err := net.Listen(network, address)
	if err != nil {
		log.Error().Err(err).Msg("[api] tls listen")
		return
	}

	log.Info().Str("addr", address).Msg("[api] tls listen")

	server := &http.Server{
		Handler:           Handler,
		TLSConfig:         &tls.Config{Certificates: []tls.Certificate{cert}},
		ReadHeaderTimeout: 5 * time.Second,
	}
	if err = server.ServeTLS(ln, "", ""); err != nil {
		log.Fatal().Err(err).Msg("[api] tls serve")
	}
}

var Port int

const (
	MimeJSON = "application/json"
	MimeText = "text/plain"
)

var Handler http.Handler

// HandleFunc handle pattern with relative path:
// - "api/streams" => "{basepath}/api/streams"
// - "/streams"    => "/streams"
func HandleFunc(pattern string, handler http.HandlerFunc) {
	if len(pattern) == 0 || pattern[0] != '/' {
		pattern = basePath + "/" + pattern
	}
	if allowPaths != nil && !slices.Contains(allowPaths, pattern) {
		log.Trace().Str("path", pattern).Msg("[api] ignore path not in allow_paths")
		return
	}
	log.Trace().Str("path", pattern).Msg("[api] register path")
	http.HandleFunc(pattern, handler)
}

// ResponseJSON important always add Content-Type
// so go won't need to call http.DetectContentType
func ResponseJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", MimeJSON)
	_ = json.NewEncoder(w).Encode(v)
}

func ResponsePrettyJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", MimeJSON)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func Response(w http.ResponseWriter, body any, contentType string) {
	w.Header().Set("Content-Type", contentType)

	switch v := body.(type) {
	case []byte:
		_, _ = w.Write(v)
	case string:
		_, _ = w.Write([]byte(v))
	default:
		_, _ = fmt.Fprint(w, body)
	}
}

const StreamNotFound = "stream not found"

var allowPaths []string
var basePath string
var log zerolog.Logger

func middlewareLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Trace().Msgf("[api] %s %s %s", r.Method, r.URL, r.RemoteAddr)
		next.ServeHTTP(w, r)
	})
}

func isLoopback(remoteAddr string) bool {
	return strings.HasPrefix(remoteAddr, "127.") || strings.HasPrefix(remoteAddr, "[::1]") || remoteAddr == "@"
}

func middlewareAuth(username, password string, localAuth bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == basePath+"/api/login" {
			loginHandler(username, password, w, r)
			return
		}
		if r.URL.Path == basePath+"/api/logout" {
			logoutHandler(w, r)
			return
		}
		if authorized(r, username, password, localAuth) {
			next.ServeHTTP(w, r)
			return
		}
		if wantsHTML(r) && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			serveLogin(w, r)
			return
		}
		w.Header().Set("Www-Authenticate", `Basic realm="go2rtc"`)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
	})
}

func authorized(r *http.Request, username, password string, localAuth bool) bool {
	if c, err := r.Cookie(sessionCookie); err == nil && sessionValid(c.Value) {
		return true
	}
	if !localAuth && isLoopback(r.RemoteAddr) {
		return true
	}
	user, pass, ok := r.BasicAuth()
	return ok && user == username && pass == password
}

// Session (cookie) auth: login page + logout support on top of Basic auth
const sessionCookie = "go2rtc_session"
const sessionTTL = 12 * time.Hour

var sessionMu sync.Mutex
var sessions = map[string]time.Time{}

func sessionValid(token string) bool {
	sessionMu.Lock()
	t, ok := sessions[token]
	sessionMu.Unlock()
	return ok && time.Since(t) < sessionTTL
}

func wantsHTML(r *http.Request) bool {
	if r.Header.Get("Sec-WebSocket-Version") != "" {
		return false
	}
	return strings.Contains(r.Header.Get("Accept"), "text/html")
}

func serveLogin(w http.ResponseWriter, r *http.Request) {
	f, err := www.Static.Open("login.html")
	if err != nil {
		w.Header().Set("Www-Authenticate", `Basic realm="go2rtc"`)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, f)
}

func loginHandler(username, password string, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		serveLogin(w, r)
		return
	}
	user, pass, have := r.BasicAuth()
	if !have {
		_ = r.ParseForm()
		user = r.PostFormValue("username")
		pass = r.PostFormValue("password")
	}
	if user == username && pass == password {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		token := hex.EncodeToString(b)
		sessionMu.Lock()
		sessions[token] = time.Now()
		sessionMu.Unlock()
		http.SetCookie(w, &http.Cookie{
			Name:     sessionCookie,
			Value:    token,
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   int(sessionTTL.Seconds()),
		})
		http.Redirect(w, r, basePath+"/", http.StatusFound)
		return
	}
	http.Redirect(w, r, basePath+"/?login=failed", http.StatusFound)
}

func logoutHandler(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		sessionMu.Lock()
		delete(sessions, c.Value)
		sessionMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
	if wantsHTML(r) && r.Method != http.MethodPost {
		serveLogin(w, r)
		return
	}
	ResponseJSON(w, map[string]string{"ok": "logout"})
}

func middlewareCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		next.ServeHTTP(w, r)
	})
}

var mu sync.Mutex

func apiHandler(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	app.Info["host"] = r.Host
	mu.Unlock()

	ResponseJSON(w, app.Info)
}

func exitHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "", http.StatusBadRequest)
		return
	}

	s := r.URL.Query().Get("code")
	code, err := strconv.Atoi(s)

	// https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html#tag_18_08_02
	if err != nil || code < 0 || code > 125 {
		http.Error(w, "Code must be in the range [0, 125]", http.StatusBadRequest)
		return
	}

	os.Exit(code)
}

func restartHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "", http.StatusBadRequest)
		return
	}

	path, err := os.Executable()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Debug().Msgf("[api] restart %s", path)

	go syscall.Exec(path, os.Args, os.Environ())
}

func logHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		// Send current state of the log file immediately
		w.Header().Set("Content-Type", "application/jsonlines")
		_, _ = app.MemoryLog.WriteTo(w)
	case "DELETE":
		app.MemoryLog.Reset()
		Response(w, "OK", "text/plain")
	default:
		http.Error(w, "Method not allowed", http.StatusBadRequest)
	}
}

type Source struct {
	ID       string `json:"id,omitempty"`
	Name     string `json:"name,omitempty"`
	Info     string `json:"info,omitempty"`
	URL      string `json:"url,omitempty"`
	Location string `json:"location,omitempty"`
}

func ResponseSources(w http.ResponseWriter, sources []*Source) {
	if len(sources) == 0 {
		http.Error(w, "no sources", http.StatusNotFound)
		return
	}

	var response = struct {
		Sources []*Source `json:"sources"`
	}{
		Sources: sources,
	}
	ResponseJSON(w, response)
}

func Error(w http.ResponseWriter, err error) {
	log.Error().Err(err).Caller(1).Send()

	http.Error(w, err.Error(), http.StatusInsufficientStorage)
}
