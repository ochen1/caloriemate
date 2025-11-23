package custom

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"

	"github.com/ignoxx/caloriemate/ai"
	"github.com/ignoxx/caloriemate/types"
	"github.com/ignoxx/caloriemate/utils"
)

// Client is a client for a custom OpenAI-compatible API.
type Client struct {
	apiKey      string
	apiEndpoint string
	visionModel string
}

// New creates a new custom OpenAI-compatible client.
func New() *Client {
	apiKey, ok := os.LookupEnv("CUSTOM_OPENAI_API_KEY")
	if !ok {
		panic("CUSTOM_OPENAI_API_KEY environment variable not set")
	}

	apiEndpoint, ok := os.LookupEnv("CUSTOM_OPENAI_ENDPOINT")
	if !ok {
		panic("CUSTOM_OPENAI_ENDPOINT environment variable not set")
	}

	visionModel := os.Getenv("CUSTOM_OPENAI_VISION_MODEL")
	if visionModel == "" {
		visionModel = "llava-hf/llava-1.5-7b-hf"
	}

	return &Client{
		apiKey:      apiKey,
		apiEndpoint: apiEndpoint,
		visionModel: visionModel,
	}
}

// OpenAI-compatible request/response structs
type ChatMessagePart struct {
	Type     string                `json:"type"`
	Text     string                `json:"text,omitempty"`
	ImageURL *ChatMessageImageURL  `json:"image_url,omitempty"`
}

type ChatMessageImageURL struct {
	URL string `json:"url"`
}

type ChatCompletionMessage struct {
	Role    string            `json:"role"`
	Content []ChatMessagePart `json:"content"`
}

type ChatCompletionRequest struct {
	Model    string                  `json:"model"`
	Messages []ChatCompletionMessage `json:"messages"`
}

type ChatCompletionResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

func (c *Client) EstimateNutritions(image io.ReadSeeker, userContext string) (types.MealTemplate, error) {
	ctx := context.Background()

	if _, err := image.Seek(0, io.SeekStart); err != nil {
		return types.MealTemplate{}, errors.New("image seek to start failed with: " + err.Error())
	}

	var imgBuf bytes.Buffer
	var promptBuf bytes.Buffer

	enc := base64.NewEncoder(base64.StdEncoding, &imgBuf)
	defer enc.Close()

	if _, err := io.Copy(enc, image); err != nil {
		return types.MealTemplate{}, errors.New("image copy to buffer failed with: " + err.Error())
	}

	type input struct {
		UserContext string
	}

	if err := ai.STAGE_SINGLE_PROMPT.Execute(&promptBuf, input{UserContext: userContext}); err != nil {
		return types.MealTemplate{}, errors.New("single stage prompt execute failed with: " + err.Error())
	}

	reqBody := ChatCompletionRequest{
		Model: c.visionModel,
		Messages: []ChatCompletionMessage{
			{
				Role: "user",
				Content: []ChatMessagePart{
					{
						Type: "text",
						Text: promptBuf.String(),
					},
					{
						Type: "image_url",
						ImageURL: &ChatMessageImageURL{
							URL: "data:image/jpeg;base64," + imgBuf.String(),
						},
					},
				},
			},
		},
	}

	reqBytes, err := json.Marshal(reqBody)
	if err != nil {
		return types.MealTemplate{}, errors.New("failed to marshal request body: " + err.Error())
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.apiEndpoint, bytes.NewReader(reqBytes))
	if err != nil {
		return types.MealTemplate{}, errors.New("failed to create request: " + err.Error())
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return types.MealTemplate{}, errors.New("chat completion request failed with: " + err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return types.MealTemplate{}, errors.New("chat completion request failed with status: " + resp.Status + " body: " + string(bodyBytes))
	}

	var completionResponse ChatCompletionResponse
	if err := json.NewDecoder(resp.Body).Decode(&completionResponse); err != nil {
		return types.MealTemplate{}, errors.New("failed to decode response body: " + err.Error())
	}

	if len(completionResponse.Choices) > 0 {
		meal, err := utils.ValidateJSON(completionResponse.Choices[0].Message.Content)
		if err != nil {
			return types.MealTemplate{}, errors.New("response JSON validation failed with: " + err.Error())
		}

		return meal, nil
	}

	return types.MealTemplate{}, errors.New("no choices in response")
}

// Make sure Client implements ai.Analyzer
var _ ai.Analyzer = (*Client)(nil)
