package main

import (
  "bytes"
  "encoding/json"
  "fmt"
  "io"
  "log"
  "net/http"
  "os"
  "strings"

  "github.com/gofiber/fiber/v2"
)

// requestPayload defines the shape of JSON sent by the extension.
type requestPayload struct {
  Text string `json:"text"`
}

// summaryResponse defines the structured JSON returned by the backend.
type summaryResponse struct {
  Summary         string   `json:"summary"`
  RedFlags        []string `json:"red_flags"`
  ImportantPoints []string `json:"important_points"`
  GreenFlags      []string `json:"green_flags"`
}

func main() {
  apiKey := os.Getenv("OPENROUTER_API_KEY")
  if apiKey == "" {
    fmt.Println("Missing OPENROUTER_API_KEY environment variable")
    os.Exit(1)
  }

  app := fiber.New()

  app.Use(func(c *fiber.Ctx) error {
    c.Set("Access-Control-Allow-Origin", "*")
    c.Set("Access-Control-Allow-Methods", "POST, OPTIONS")
    c.Set("Access-Control-Allow-Headers", "Content-Type")
    if c.Method() == http.MethodOptions {
      return c.SendStatus(http.StatusNoContent)
    }
    return c.Next()
  })

  app.Post("/summarize", func(c *fiber.Ctx) error {
    var payload requestPayload
    if err := c.BodyParser(&payload); err != nil {
      return fiber.NewError(fiber.StatusBadRequest, "invalid JSON payload")
    }

    if strings.TrimSpace(payload.Text) == "" {
      return fiber.NewError(fiber.StatusBadRequest, "text field is required")
    }

    response, err := callOpenRouter(apiKey, payload.Text)
    if err != nil {
      return fiber.NewError(fiber.StatusInternalServerError, err.Error())
    }

    return c.JSON(response)
  })

  port := os.Getenv("PORT")
  if port == "" {
    port = "8080"
  }

  fmt.Printf("Backend running on port %s\n", port)
  log.Fatal(app.Listen(":" + port))
}

func callOpenRouter(apiKey, text string) (*summaryResponse, error) {
  prompt := buildPrompt(text)
  requestBody := map[string]interface{}{
    "model": "gpt-4o-mini",
    "messages": []map[string]string{
      {"role": "user", "content": prompt},
    },
    "max_tokens": 512,
    "temperature": 0.5,
  }

  bodyBytes, err := json.Marshal(requestBody)
  if err != nil {
    return nil, fmt.Errorf("failed to marshal request: %w", err)
  }

  req, err := http.NewRequest("POST", "https://openrouter.ai/api/v1/chat/completions", bytes.NewReader(bodyBytes))
  if err != nil {
    return nil, fmt.Errorf("failed to create openrouter request: %w", err)
  }

  req.Header.Set("Authorization", "Bearer "+apiKey)
  req.Header.Set("Content-Type", "application/json")
  req.Header.Set("HTTP-Referer", "https://your-app.com")
  req.Header.Set("X-Title", "Privacy Policy Summarizer")

  client := &http.Client{}
  resp, err := client.Do(req)
  if err != nil {
    return nil, fmt.Errorf("request failed: %w", err)
  }
  defer resp.Body.Close()

  if resp.StatusCode != http.StatusOK {
    bodyBytes, _ := io.ReadAll(resp.Body)
    if resp.StatusCode == http.StatusTooManyRequests {
      return nil, fmt.Errorf("OpenRouter rate limited the request. Please wait a few minutes or choose a different model.")
    }
    return nil, fmt.Errorf("openrouter returned %d: %s", resp.StatusCode, string(bodyBytes))
  }

  var inferenceResult struct {
    Choices []struct {
      Message struct {
        Content string `json:"content"`
      } `json:"message"`
    } `json:"choices"`
  }

  rawBody, err := io.ReadAll(resp.Body)
  if err != nil {
    return nil, fmt.Errorf("failed to read response: %w", err)
  }

  if err := json.Unmarshal(rawBody, &inferenceResult); err != nil {
    return nil, fmt.Errorf("failed to parse OpenRouter response: %w", err)
  }

  if len(inferenceResult.Choices) == 0 {
    return nil, fmt.Errorf("empty inference response")
  }

  jsonText := inferenceResult.Choices[0].Message.Content
  parsed, err := parseStructuredJSON(jsonText)
  if err != nil {
    return nil, fmt.Errorf("failed to parse generated JSON: %w", err)
  }

  return parsed, nil
}

func buildPrompt(text string) string {
  trimmed := strings.TrimSpace(text)
  return fmt.Sprintf(`You are an assistant that reads website terms, privacy policies, and user agreements.
Extract the most important information and return valid JSON only with these keys:
- summary: a short paragraph
- red_flags: a list of risky clauses or warnings
- important_points: a list of items the user must notice
- green_flags: a list of user-friendly or beneficial clauses

Analyze this text:
%s

Respond with valid JSON only.`, trimmed)
}

func parseStructuredJSON(generated string) (*summaryResponse, error) {
  start := strings.Index(generated, "{")
  end := strings.LastIndex(generated, "}")
  if start < 0 || end < 0 || end <= start {
    return nil, fmt.Errorf("no JSON object found in generated text")
  }

  candidate := generated[start : end+1]
  var result summaryResponse
  if err := json.Unmarshal([]byte(candidate), &result); err != nil {
    return nil, err
  }

  if result.RedFlags == nil {
    result.RedFlags = []string{}
  }
  if result.ImportantPoints == nil {
    result.ImportantPoints = []string{}
  }
  if result.GreenFlags == nil {
    result.GreenFlags = []string{}
  }

  return &result, nil
}
