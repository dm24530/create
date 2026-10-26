//go:build unit

package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestCompatibleImagesGeminiModels(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, model := range []string{"gemini-2.5-flash-image", "gemini-2.5-flash-image-preview", "gemini-3-pro-image", "gemini-3.1-flash-image"} {
		t.Run(model, func(t *testing.T) {
			body := []byte(fmt.Sprintf(`{"model":%q,"prompt":"draw"}`, model))
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, openAIImagesGenerationsEndpoint, bytes.NewReader(body))
			parsed, err := (&OpenAIGatewayService{}).ParseOpenAIImagesRequest(c, body)
			require.NoError(t, err)
			require.True(t, (&Account{Platform: PlatformOpenAI, Type: AccountTypeAPIKey}).SupportsOpenAIImageCapability(parsed.RequiredCapability))
			for _, typ := range []string{AccountTypeOAuth, AccountTypeSetupToken} {
				require.False(t, (&Account{Platform: PlatformOpenAI, Type: typ}).SupportsOpenAIImageCapability(parsed.RequiredCapability))
			}
			require.False(t, isOpenAIImageGenerationModel(model), "compatible image IDs must not enter native Responses normalization")
		})
	}
	for _, model := range []string{"gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-pro-imageless", "unknown-image", "gpt-5.5"} {
		t.Run("reject_"+model, func(t *testing.T) {
			body := []byte(fmt.Sprintf(`{"model":%q,"prompt":"draw"}`, model))
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, openAIImagesGenerationsEndpoint, bytes.NewReader(body))
			_, err := (&OpenAIGatewayService{}).ParseOpenAIImagesRequest(c, body)
			require.ErrorContains(t, err, "images endpoint requires an image model")
		})
	}
}

func TestOpenAIImagesSchedulerUsesExplicitCrossPlatformModelMapping(t *testing.T) {
	groupID := int64(3)
	repo := &compositeOwnershipAccountRepo{
		accounts: []Account{{
			ID:          6,
			Platform:    PlatformGemini,
			Type:        AccountTypeAPIKey,
			Status:      StatusActive,
			Schedulable: true,
			Credentials: map[string]any{
				"base_url": "https://compatible.example",
				"api_key":  "sk-test",
				"model_mapping": map[string]any{
					"gpt-image-2": "gpt-image-2",
				},
			},
		}},
	}
	svc := &OpenAIGatewayService{accountRepo: repo}

	tests := []struct {
		name string
		ctx  context.Context
	}{
		{name: "unresolved_fallback", ctx: WithCompositeImagesRouting(context.Background())},
		{
			name: "account_route_context",
			ctx: WithCompositeRouteDecision(WithCompositeImagesRouting(context.Background()), CompositeRouteDecision{
				Matched:        true,
				Source:         CompositeRouteSourceAccount,
				TargetPlatform: PlatformGemini,
				PublicModel:    "gpt-image-2",
				UpstreamModel:  "gpt-image-2",
			}),
		},
		{
			name: "explicit_openai_route_falls_back_to_unique_mapping",
			ctx: WithCompositeRouteDecision(WithCompositeImagesRouting(context.Background()), CompositeRouteDecision{
				Matched:        true,
				Source:         CompositeRouteSourceExplicit,
				TargetPlatform: PlatformOpenAI,
				PublicModel:    "gpt-image-2",
				UpstreamModel:  "gpt-image-2",
			}),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			selection, _, err := svc.SelectAccountWithSchedulerForImages(
				tt.ctx,
				&groupID,
				"",
				"gpt-image-2",
				nil,
				OpenAIImagesCapabilityAPIKey,
			)

			require.NoError(t, err)
			require.NotNil(t, selection)
			require.NotNil(t, selection.Account)
			require.Equal(t, int64(6), selection.Account.ID)
			require.True(t, selection.Acquired)
		})
	}
}

func TestOpenAIImagesSchedulerRejectsAmbiguousCrossPlatformMappings(t *testing.T) {
	groupID := int64(3)
	repo := &compositeOwnershipAccountRepo{
		accounts: []Account{
			{
				ID:          6,
				Platform:    PlatformGemini,
				Type:        AccountTypeAPIKey,
				Status:      StatusActive,
				Schedulable: true,
				Credentials: map[string]any{
					"base_url":      "https://gemini-compatible.example",
					"api_key":       "sk-gemini",
					"model_mapping": map[string]any{"shared-image": "gemini-3-pro-image"},
				},
			},
			{
				ID:          7,
				Platform:    PlatformGrok,
				Type:        AccountTypeAPIKey,
				Status:      StatusActive,
				Schedulable: true,
				Credentials: map[string]any{
					"base_url":      "https://grok-compatible.example",
					"api_key":       "sk-grok",
					"model_mapping": map[string]any{"shared-image": "grok-imagine"},
				},
			},
		},
	}
	svc := &OpenAIGatewayService{accountRepo: repo}

	selection, _, err := svc.SelectAccountWithSchedulerForImages(
		WithCompositeImagesRouting(context.Background()),
		&groupID,
		"",
		"shared-image",
		nil,
		OpenAIImagesCapabilityAPIKey,
	)

	require.Nil(t, selection)
	require.ErrorIs(t, err, ErrNoAvailableAccounts)
	require.ErrorContains(t, err, "ambiguous")
}

func TestOpenAIImagesSchedulerDoesNotUseUnmappedCrossPlatformAccount(t *testing.T) {
	groupID := int64(3)
	repo := &compositeOwnershipAccountRepo{
		accounts: []Account{{
			ID:          6,
			Platform:    PlatformGemini,
			Type:        AccountTypeAPIKey,
			Status:      StatusActive,
			Schedulable: true,
			Credentials: map[string]any{
				"base_url": "https://compatible.example",
				"api_key":  "sk-test",
			},
		}},
	}
	svc := &OpenAIGatewayService{accountRepo: repo}

	selection, _, err := svc.SelectAccountWithSchedulerForImages(
		WithCompositeImagesRouting(context.Background()),
		&groupID,
		"",
		"gpt-image-2",
		nil,
		OpenAIImagesCapabilityNative,
	)

	require.Nil(t, selection)
	require.ErrorIs(t, err, ErrNoAvailableAccounts)
}

func TestOpenAIImagesSchedulerUsesResolvedPlatformForDirectCompatibleModel(t *testing.T) {
	groupID := int64(3)
	repo := &compositeOwnershipAccountRepo{
		accounts: []Account{{
			ID:          6,
			Platform:    PlatformGemini,
			Type:        AccountTypeAPIKey,
			Status:      StatusActive,
			Schedulable: true,
			Credentials: map[string]any{
				"base_url": "https://compatible.example",
				"api_key":  "sk-test",
			},
		}},
	}
	svc := &OpenAIGatewayService{accountRepo: repo}
	ctx := WithResolvedTargetPlatform(WithCompositeImagesRouting(context.Background()), PlatformGemini)

	selection, _, err := svc.SelectAccountWithSchedulerForImages(
		ctx,
		&groupID,
		"",
		"gemini-3.1-flash-image",
		nil,
		OpenAIImagesCapabilityAPIKey,
	)

	require.NoError(t, err)
	require.NotNil(t, selection)
	require.Equal(t, int64(6), selection.Account.ID)
	require.True(t, selection.Acquired)
}

func TestOpenAIImagesSchedulerRejectsNativeOnlyAccountsForCompatibleModel(t *testing.T) {
	groupID := int64(3)
	repo := &compositeOwnershipAccountRepo{
		accounts: []Account{
			{
				ID:          1,
				Platform:    PlatformOpenAI,
				Type:        AccountTypeOAuth,
				Status:      StatusActive,
				Schedulable: true,
				Credentials: map[string]any{
					"access_token":  "unused-native-token",
					"model_mapping": map[string]any{"gemini-3.1-flash-image": "gemini-3.1-flash-image"},
				},
			},
			{
				ID:          2,
				Platform:    PlatformOpenAI,
				Type:        AccountTypeSetupToken,
				Status:      StatusActive,
				Schedulable: true,
				Credentials: map[string]any{
					"access_token":  "unused-native-token",
					"model_mapping": map[string]any{"gemini-3.1-flash-image": "gemini-3.1-flash-image"},
				},
			},
		},
	}
	svc := &OpenAIGatewayService{accountRepo: repo}
	ctx := WithResolvedTargetPlatform(WithCompositeImagesRouting(context.Background()), PlatformOpenAI)

	selection, _, err := svc.SelectAccountWithSchedulerForImages(
		ctx,
		&groupID,
		"",
		"gemini-3.1-flash-image",
		nil,
		OpenAIImagesCapabilityAPIKey,
	)

	require.Nil(t, selection)
	require.ErrorIs(t, err, ErrNoAvailableAccounts)
}

func TestCompatibleImagesParseUsesResolvedCrossPlatformUpstreamModel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body := []byte(`{"model":"public-image","prompt":"draw"}`)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, openAIImagesGenerationsEndpoint, bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request = c.Request.WithContext(WithCompositeRouteDecision(c.Request.Context(), CompositeRouteDecision{
		Matched:        true,
		TargetPlatform: PlatformGemini,
		UpstreamModel:  "gemini-3-pro-image",
		PublicModel:    "public-image",
	}))

	parsed, err := (&OpenAIGatewayService{}).ParseOpenAIImagesRequest(c, body)

	require.NoError(t, err)
	require.Equal(t, "gemini-3-pro-image", parsed.Model)
	require.Equal(t, OpenAIImagesCapabilityAPIKey, parsed.RequiredCapability)
}

func TestCompatibleImagesForwardGemini(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, kind := range []string{"generation", "json_edit", "multipart_edit", "composite_multipart_alias", "channel_mapping", "account_mapping", "cross_platform_account_mapping", "cross_platform_multipart_edit"} {
		t.Run(kind, func(t *testing.T) {
			model := "gemini-3.1-flash-image"
			endpoint := openAIImagesGenerationsEndpoint
			contentType := "application/json"
			channelModel := ""
			accountPlatform := PlatformOpenAI
			credentials := map[string]any{"api_key": "image-key", "base_url": "https://compatible.example/v1"}
			requestModel := model
			if kind == "channel_mapping" {
				requestModel, channelModel = "gpt-image-2", model
			}
			if kind == "account_mapping" || strings.HasPrefix(kind, "cross_platform_") {
				requestModel = "gpt-image-2"
				credentials["model_mapping"] = map[string]any{requestModel: model}
				if strings.HasPrefix(kind, "cross_platform_") {
					accountPlatform = PlatformGemini
				}
			}
			body := []byte(fmt.Sprintf(`{"model":%q,"prompt":"draw","size":"1024x1024","custom_field":"preserved"}`, requestModel))
			if kind == "json_edit" {
				endpoint = openAIImagesEditsEndpoint
				body = []byte(fmt.Sprintf(`{"model":%q,"prompt":"draw","images":[{"image_url":"https://source.example/input.png"}],"custom_field":"preserved"}`, model))
			}
			if strings.Contains(kind, "multipart") {
				endpoint = openAIImagesEditsEndpoint
				if kind == "composite_multipart_alias" {
					requestModel = "public-image"
				}
				var buf bytes.Buffer
				writer := multipart.NewWriter(&buf)
				require.NoError(t, writer.WriteField("model", requestModel))
				require.NoError(t, writer.WriteField("prompt", "draw"))
				require.NoError(t, writer.WriteField("custom_field", "preserved"))
				part, err := writer.CreateFormFile("image", "input.png")
				require.NoError(t, err)
				_, err = part.Write([]byte("original-image-bytes"))
				require.NoError(t, err)
				require.NoError(t, writer.Close())
				body, contentType = buf.Bytes(), writer.FormDataContentType()
			}
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)
			c.Request = httptest.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
			c.Request.Header.Set("Content-Type", contentType)
			if kind == "composite_multipart_alias" {
				ctx := WithResolvedTargetPlatform(c.Request.Context(), PlatformOpenAI)
				ctx = WithCompositeRouteDecision(ctx, CompositeRouteDecision{Matched: true, TargetPlatform: PlatformOpenAI, UpstreamModel: model, PublicModel: requestModel})
				c.Request = c.Request.WithContext(ctx)
			}
			upstream := &httpUpstreamRecorder{resp: &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"data":[{"b64_json":"aW1hZ2U="}]}`))}}
			svc := &OpenAIGatewayService{cfg: &config.Config{}, httpUpstream: upstream}
			parsed, err := svc.ParseOpenAIImagesRequest(c, body)
			require.NoError(t, err)
			if kind == "channel_mapping" {
				require.Equal(t, OpenAIImagesCapabilityAPIKey, parsed.RequiredCapabilityForModel(channelModel))
			}
			result, err := svc.ForwardImages(c.Request.Context(), c, &Account{ID: 1, Platform: accountPlatform, Type: AccountTypeAPIKey, Credentials: credentials}, body, parsed, channelModel)
			require.NoError(t, err)
			require.Equal(t, 1, result.ImageCount)
			require.Equal(t, model, result.UpstreamModel)
			require.Equal(t, firstNonEmptyString(channelModel, parsed.Model), result.Model)
			require.Equal(t, "https://compatible.example"+endpoint, upstream.lastReq.URL.String())
			require.Equal(t, "Bearer image-key", upstream.lastReq.Header.Get("Authorization"))
			if strings.Contains(kind, "multipart") {
				r := httptest.NewRequest(http.MethodPost, endpoint, bytes.NewReader(upstream.lastBody))
				r.Header.Set("Content-Type", upstream.lastReq.Header.Get("Content-Type"))
				require.NoError(t, r.ParseMultipartForm(1<<20))
				require.Equal(t, model, r.FormValue("model"))
				require.Equal(t, "preserved", r.FormValue("custom_field"))
				file, _, err := r.FormFile("image")
				require.NoError(t, err)
				defer file.Close()
				data, err := io.ReadAll(file)
				require.NoError(t, err)
				require.Equal(t, "original-image-bytes", string(data))
			} else {
				require.Equal(t, model, gjson.GetBytes(upstream.lastBody, "model").String())
				require.Equal(t, "preserved", gjson.GetBytes(upstream.lastBody, "custom_field").String())
			}
		})
	}
}

func TestCompatibleImagesNativeAccountsRejectGeminiBeforeForwarding(t *testing.T) {
	for _, typ := range []string{AccountTypeOAuth, AccountTypeSetupToken} {
		for _, mapping := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/mapping=%t", typ, mapping), func(t *testing.T) {
				model := "gemini-3-pro-image"
				account := &Account{Platform: PlatformOpenAI, Type: typ, Credentials: map[string]any{"access_token": "unused"}}
				if mapping {
					account.Credentials["model_mapping"] = map[string]any{"gpt-image-2": model}
					model = "gpt-image-2"
				}
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Request = httptest.NewRequest(http.MethodPost, openAIImagesGenerationsEndpoint, nil)
				upstream := &httpUpstreamRecorder{}
				svc := &OpenAIGatewayService{httpUpstream: upstream}
				_, err := svc.ForwardImages(context.Background(), c, account, nil, &OpenAIImagesRequest{Model: model}, "")
				require.ErrorContains(t, err, "images endpoint requires an image model")
				require.Empty(t, upstream.requests)
			})
		}
	}
}
