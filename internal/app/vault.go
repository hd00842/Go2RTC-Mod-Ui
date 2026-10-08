package app

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"gopkg.in/yaml.v3"
)

// vaultStorage keeps secrets encrypted (AES-256-GCM) in "secrets.yaml"
// next to the config file. The master key lives in "secrets.key" (0600).
type vaultStorage struct {
	mu   sync.Mutex
	dir  string
	key  []byte
	data map[string]string
}

var vault *vaultStorage

type vaultFile struct {
	Version int               `yaml:"version"`
	Entries map[string]string `yaml:"entries"`
}

func newVault(dir string) (*vaultStorage, error) {
	v := &vaultStorage{dir: dir, data: map[string]string{}}

	keyPath := filepath.Join(dir, "secrets.key")
	if b, err := os.ReadFile(keyPath); err == nil && len(b) >= 32 {
		v.key = append([]byte{}, b[:32]...)
	} else {
		v.key = make([]byte, 32)
		if _, err := rand.Read(v.key); err != nil {
			return nil, err
		}
		if err := os.WriteFile(keyPath, v.key, 0600); err != nil {
			return nil, err
		}
	}

	v.load()
	return v, nil
}

func (v *vaultStorage) load() {
	b, err := os.ReadFile(filepath.Join(v.dir, "secrets.yaml"))
	if err != nil {
		return
	}
	var vf vaultFile
	if err = yaml.Unmarshal(b, &vf); err != nil {
		return
	}
	if vf.Entries != nil {
		v.data = vf.Entries
	}
}

func (v *vaultStorage) save() error {
	vf := vaultFile{Version: 1, Entries: v.data}
	b, err := yaml.Marshal(&vf)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(v.dir, "secrets.yaml"), b, 0600)
}

func (v *vaultStorage) seal(value string) (string, error) {
	block, err := aes.NewCipher(v.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(value), nil)), nil
}

func (v *vaultStorage) open(sealed string) (string, bool) {
	ct, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil {
		return "", false
	}
	block, err := aes.NewCipher(v.key)
	if err != nil {
		return "", false
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", false
	}
	ns := gcm.NonceSize()
	if len(ct) < ns {
		return "", false
	}
	b, err := gcm.Open(nil, ct[:ns], ct[ns:], nil)
	if err != nil {
		return "", false
	}
	return string(b), true
}

func (v *vaultStorage) GetValue(name string) (string, bool) {
	v.mu.Lock()
	sealed, ok := v.data[name]
	v.mu.Unlock()
	if !ok {
		return "", false
	}
	return v.open(sealed)
}

func (v *vaultStorage) SetValue(name, value string) error {
	sealed, err := v.seal(value)
	if err != nil {
		return err
	}
	v.mu.Lock()
	v.data[name] = sealed
	err = v.save()
	v.mu.Unlock()
	return err
}

func (v *vaultStorage) DeleteValue(name string) error {
	v.mu.Lock()
	delete(v.data, name)
	err := v.save()
	v.mu.Unlock()
	return err
}

func (v *vaultStorage) Names() []string {
	v.mu.Lock()
	names := make([]string, 0, len(v.data))
	for name := range v.data {
		names = append(names, name)
	}
	v.mu.Unlock()
	sort.Strings(names)
	return names
}

// Package level helpers used by the secrets API module.
func VaultEnabled() bool { return vault != nil }

func VaultGet(name string) (string, bool) {
	if vault == nil {
		return "", false
	}
	return vault.GetValue(name)
}

func VaultSet(name, value string) error {
	if vault == nil {
		return errors.New("secrets vault disabled")
	}
	return vault.SetValue(name, value)
}

func VaultDelete(name string) error {
	if vault == nil {
		return errors.New("secrets vault disabled")
	}
	return vault.DeleteValue(name)
}

func VaultNames() []string {
	if vault == nil {
		return nil
	}
	return vault.Names()
}
