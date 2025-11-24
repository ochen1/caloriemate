package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("activity_logs")
		if err != nil {
			return err
		}

		return app.Delete(collection)
	}, func(app core.App) error {
		// Rollback not implemented - if we need to rollback,
		// the original migration file still exists and can recreate the table
		return nil
	})
}
