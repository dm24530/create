package handler

import (
	"testing"
	"time"
)

func TestKeyEventBrokerPublishesToUser(t *testing.T) {
	broker := &keyEventBroker{subscribers: make(map[int64]map[chan []byte]struct{})}
	events, unsubscribe := broker.subscribe(42)
	defer unsubscribe()

	broker.publish(42, "created", 7)
	select {
	case payload := <-events:
		if string(payload) != `{"operation":"created","key_id":7}` {
			t.Fatalf("unexpected payload: %s", payload)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for key event")
	}
}

func TestKeyEventBrokerDoesNotCrossUsers(t *testing.T) {
	broker := &keyEventBroker{subscribers: make(map[int64]map[chan []byte]struct{})}
	events, unsubscribe := broker.subscribe(1)
	defer unsubscribe()
	broker.publish(2, "deleted", 9)
	select {
	case payload := <-events:
		t.Fatalf("unexpected cross-user event: %s", payload)
	case <-time.After(50 * time.Millisecond):
	}
}
