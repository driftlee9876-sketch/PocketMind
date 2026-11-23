// Package link pairs foreground GPU providers with a PocketMind inference host.
package link

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"time"
)

func pin(c *x509.Certificate) string {
	hash := sha256.Sum256(c.RawSubjectPublicKeyInfo)
	return base64.RawURLEncoding.EncodeToString(hash[:])
}
func identity(dir string) (tls.Certificate, string, map[string]bool, error) {
	var cert tls.Certificate
	if err := os.MkdirAll(dir, 0700); err != nil {
		return cert, "", nil, err
	}
	path := filepath.Join(dir, "identity")
	seed, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		seed = make([]byte, ed25519.SeedSize)
		if _, err = rand.Read(seed); err != nil {
			return cert, "", nil, err
		}
		err = atomicWrite(path, seed)
	}
	if err != nil || len(seed) != ed25519.SeedSize {
		return cert, "", nil, fmt.Errorf("device identity unavailable")
	}
	key := ed25519.NewKeyFromSeed(seed)
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 120))
	if err != nil {
		return cert, "", nil, err
	}
	now := time.Now()
	leaf := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "PocketMind GPU"}, NotBefore: now.Add(-24 * time.Hour), NotAfter: now.AddDate(1, 0, 0), KeyUsage: x509.KeyUsageDigitalSignature}
	der, err := x509.CreateCertificate(rand.Reader, leaf, leaf, key.Public(), key)
	if err != nil {
		return cert, "", nil, err
	}
	leaf, err = x509.ParseCertificate(der)
	if err != nil {
		return cert, "", nil, err
	}
	cert = tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key, Leaf: leaf}
	peers := map[string]bool{}
	raw, err := os.ReadFile(filepath.Join(dir, "peers.json"))
	if err == nil {
		err = json.Unmarshal(raw, &peers)
	} else if os.IsNotExist(err) {
		err = nil
	}
	if peers == nil {
		peers = map[string]bool{}
	}
	return cert, pin(leaf), peers, err
}
func atomicWrite(path string, b []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".write-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, err = f.Write(b)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}
