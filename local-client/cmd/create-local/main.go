package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/diminglucky/create/local-client/internal/config"
	"github.com/diminglucky/create/local-client/internal/save"
	localserver "github.com/diminglucky/create/local-client/internal/server"
	"github.com/diminglucky/create/local-client/internal/updater"
)

const defaultRemoteURL = "https://create.superai.sbs"

var Version = "dev"

func main() {
	port := flag.Int("port", 0, "local listen port; 0 selects a random free port")
	noOpen := flag.Bool("no-open", false, "do not open the default browser")
	dataDir := flag.String("data-dir", "", "local data directory override")
	flag.Parse()

	root := *dataDir
	if root == "" {
		var err error
		root, err = config.DefaultRoot()
		if err != nil {
			log.Fatal(err)
		}
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		log.Fatal(err)
	}

	remoteURL := defaultRemoteURL
	if os.Getenv("CREATE_LOCAL_DEV") == "1" && os.Getenv("CREATE_LOCAL_REMOTE_URL") != "" {
		remoteURL = os.Getenv("CREATE_LOCAL_REMOTE_URL")
	}
	settingsStore := config.NewStore(root)
	saveStore := save.New(root)
	handler, err := localserver.New(remoteURL, settingsStore, saveStore)
	if err != nil {
		log.Fatal(err)
	}
	updateManager, err := updater.New(Version, root)
	if err != nil {
		log.Printf("Update manager unavailable: %v", err)
	} else {
		handler.SetUpdater(updateManager)
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := updateManager.Check(ctx); err != nil {
				log.Printf("Update check failed: %v", err)
			}
		}()
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		log.Fatal(err)
	}
	address := listener.Addr().(*net.TCPAddr)
	url := fmt.Sprintf("http://127.0.0.1:%d/", address.Port)
	log.Printf("Create Local %s: %s", Version, url)
	log.Printf("Remote server: %s", remoteURL)
	log.Printf("Data directory: %s", filepath.Clean(root))
	log.Printf("Close this window or press Ctrl+C to stop Create Local.")

	if !*noOpen {
		go func() {
			time.Sleep(350 * time.Millisecond)
			if err := openBrowser(url); err != nil {
				log.Printf("Failed to open browser: %v", err)
			}
		}()
	}

	httpServer := &http.Server{
		Handler:           handler.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-shutdown
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(ctx)
	}()
	if err := httpServer.Serve(listener); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func openBrowser(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}

func init() {
	log.SetFlags(log.Ldate | log.Ltime)
}
