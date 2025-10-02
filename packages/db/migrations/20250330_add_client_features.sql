CREATE TABLE IF NOT EXISTS client_features (
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    feature TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, feature)
);
