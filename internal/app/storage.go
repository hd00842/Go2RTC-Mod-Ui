package app

import (
	"path/filepath"
	"sync"

	"github.com/AlexxIT/go2rtc/pkg/creds"
	"github.com/AlexxIT/go2rtc/pkg/yaml"
)

func initStorage() {
	envStore = &envStorage{data: make(map[string]string)}

	if ConfigPath != "" {
		if v, err := newVault(filepath.Dir(ConfigPath)); err == nil {
			vault = v
		} else {
			Logger.Warn().Err(err).Msg("[app] secrets vault disabled")
		}
	}

	creds.SetStorage(&compositeStorage{})
}

// compositeStorage reads from the encrypted vault first, then from the
// plain "env:" section of the config. Writes always go to the vault.
type compositeStorage struct{}

func (c *compositeStorage) GetValue(name string) (string, bool) {
	if vault != nil {
		if value, ok := vault.GetValue(name); ok {
			return value, true
		}
	}
	return envStore.GetValue(name)
}

func (c *compositeStorage) SetValue(name, value string) error {
	if vault == nil {
		return envStore.SetValue(name, value)
	}
	return vault.SetValue(name, value)
}

func loadEnv(data []byte) {
	var cfg struct {
		Env map[string]string `yaml:"env"`
	}

	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return
	}

	envStore.mu.Lock()
	for name, value := range cfg.Env {
		envStore.data[name] = value
		creds.AddSecret(value)
	}
	envStore.mu.Unlock()
}

var envStore *envStorage

type envStorage struct {
	data map[string]string
	mu   sync.Mutex
}

func (s *envStorage) SetValue(name, value string) error {
	if err := PatchConfig([]string{"env", name}, value); err != nil {
		return err
	}

	s.mu.Lock()
	s.data[name] = value
	s.mu.Unlock()

	return nil
}

func (s *envStorage) GetValue(name string) (value string, ok bool) {
	s.mu.Lock()
	value, ok = s.data[name]
	s.mu.Unlock()
	return
}
