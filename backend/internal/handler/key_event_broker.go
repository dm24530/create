package handler

import (
	"encoding/json"
	"sync"
)

type keyEventPayload struct {
	Operation string `json:"operation"`
	KeyID     int64  `json:"key_id,omitempty"`
}

type keyEventBroker struct {
	mu          sync.RWMutex
	subscribers map[int64]map[chan []byte]struct{}
}

var userKeyEvents = &keyEventBroker{
	subscribers: make(map[int64]map[chan []byte]struct{}),
}

func (b *keyEventBroker) subscribe(userID int64) (<-chan []byte, func()) {
	channel := make(chan []byte, 1)
	b.mu.Lock()
	if b.subscribers[userID] == nil {
		b.subscribers[userID] = make(map[chan []byte]struct{})
	}
	b.subscribers[userID][channel] = struct{}{}
	b.mu.Unlock()
	return channel, func() {
		b.mu.Lock()
		if subscribers := b.subscribers[userID]; subscribers != nil {
			delete(subscribers, channel)
			if len(subscribers) == 0 {
				delete(b.subscribers, userID)
			}
		}
		b.mu.Unlock()
	}
}

func (b *keyEventBroker) publish(userID int64, operation string, keyID int64) {
	payload, err := json.Marshal(keyEventPayload{Operation: operation, KeyID: keyID})
	if err != nil {
		return
	}
	b.mu.RLock()
	subscribers := b.subscribers[userID]
	channels := make([]chan []byte, 0, len(subscribers))
	for channel := range subscribers {
		channels = append(channels, channel)
	}
	b.mu.RUnlock()
	for _, channel := range channels {
		select {
		case channel <- payload:
		default:
		}
	}
}

func publishUserKeyEvent(userID int64, operation string, keyID int64) {
	userKeyEvents.publish(userID, operation, keyID)
}
