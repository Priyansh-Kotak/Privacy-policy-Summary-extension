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
  apiKey := os.Getenv("GEMINI_API_KEY")
  if apiKey == "" {
    fmt.Println("Missing GEMINI_API_KEY environment variable")
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

    response, err := callGemini(apiKey, payload.Text)
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

func callGemini(apiKey, text string) (*summaryResponse, error) {
  prompt := buildPrompt(text)
  requestBody := map[string]interface{}{
    "contents": []map[string]interface{}{
      {
        "parts": []map[string]string{
          {"text": prompt},
        },
      },
    },
    "generationConfig": map[string]interface{}{
      "temperature":      0.3,
      "responseMimeType": "application/json",
      "responseSchema": map[string]interface{}{
        "type": "OBJECT",
        "properties": map[string]interface{}{
          "summary": map[string]string{
            "type": "STRING",
          },
          "red_flags": map[string]interface{}{
            "type": "ARRAY",
            "items": map[string]string{
              "type": "STRING",
            },
          },
          "important_points": map[string]interface{}{
            "type": "ARRAY",
            "items": map[string]string{
              "type": "STRING",
            },
          },
          "green_flags": map[string]interface{}{
            "type": "ARRAY",
            "items": map[string]string{
              "type": "STRING",
            },
          },
        },
        "required": []string{"summary", "red_flags", "important_points", "green_flags"},
        "propertyOrdering": []string{"summary", "red_flags", "important_points", "green_flags"},
      },
    },
  }

  bodyBytes, err := json.Marshal(requestBody)
  if err != nil {
    return nil, fmt.Errorf("failed to marshal request: %w", err)
  }

  req, err := http.NewRequest(
    "POST",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
    bytes.NewReader(bodyBytes),
  )
  if err != nil {
    return nil, fmt.Errorf("failed to create Gemini request: %w", err)
  }

  req.Header.Set("x-goog-api-key", apiKey)
  req.Header.Set("Content-Type", "application/json")

  client := &http.Client{}
  resp, err := client.Do(req)
  if err != nil {
    return nil, fmt.Errorf("request failed: %w", err)
  }
  defer resp.Body.Close()

  if resp.StatusCode != http.StatusOK {
    bodyBytes, _ := io.ReadAll(resp.Body)
    return nil, fmt.Errorf("gemini returned %d: %s", resp.StatusCode, string(bodyBytes))
  }

  var inferenceResult struct {
    Candidates []struct {
      Content struct {
        Parts []struct {
          Text string `json:"text"`
        } `json:"parts"`
      } `json:"content"`
    } `json:"candidates"`
  }

  rawBody, err := io.ReadAll(resp.Body)
  if err != nil {
    return nil, fmt.Errorf("failed to read response: %w", err)
  }

  if err := json.Unmarshal(rawBody, &inferenceResult); err != nil {
    return nil, fmt.Errorf("failed to parse Gemini response: %w", err)
  }

  if len(inferenceResult.Candidates) == 0 || len(inferenceResult.Candidates[0].Content.Parts) == 0 {
    return nil, fmt.Errorf("empty Gemini response")
  }

  jsonText := inferenceResult.Candidates[0].Content.Parts[0].Text
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
