package apis

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"

	"github.com/samber/lo"
	"go.opentelemetry.io/otel"
)

type PermissionsAPI struct {
	permissionsURL *url.URL
}

func NewPermissionsAPI(permissionsURL *url.URL) *PermissionsAPI {
	return &PermissionsAPI{
		permissionsURL: permissionsURL,
	}
}

type Permission struct {
	ResourceName string `json:"resource_name"`
}
type PermissionsResponse struct {
	Permissions []Permission `json:"permissions"`
}

func (p *PermissionsAPI) GetPublicIDS(ctx context.Context, publicGroup string) ([]string, error) {
	ctx, span := otel.Tracer(otelName).Start(ctx, "GetPublicIDS")
	defer span.End()

	fullURL := *p.permissionsURL
	fullURL = *fullURL.JoinPath("permissions", "abbreviated", "subjects", "group", publicGroup, "app")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fullURL.String(), nil)
	if err != nil {
		return nil, err
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("status code was not 200")
	}
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var body PermissionsResponse
	if err = json.Unmarshal(b, &body); err != nil {
		return nil, err
	}
	retval := lo.Map(body.Permissions, func(item Permission, index int) string {
		return item.ResourceName
	})
	return retval, nil
}
