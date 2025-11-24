package migrations

import (
	"encoding/json"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		// Update meal_templates delete rule
		mealTemplates, err := app.FindCollectionByNameOrId("meal_templates")
		if err != nil {
			return err
		}

		if err := json.Unmarshal([]byte(`{
			"deleteRule": "@request.auth.id != \"\" && user.id ?= @request.auth.id"
		}`), &mealTemplates); err != nil {
			return err
		}

		if err := app.Save(mealTemplates); err != nil {
			return err
		}

		// Update meal_history delete rule
		mealHistory, err := app.FindCollectionByNameOrId("meal_history")
		if err != nil {
			return err
		}

		if err := json.Unmarshal([]byte(`{
			"deleteRule": "@request.auth.id != \"\" && user.id ?= @request.auth.id"
		}`), &mealHistory); err != nil {
			return err
		}

		return app.Save(mealHistory)
	}, func(app core.App) error {
		// Revert meal_templates delete rule
		mealTemplates, err := app.FindCollectionByNameOrId("meal_templates")
		if err != nil {
			return err
		}

		if err := json.Unmarshal([]byte(`{
			"deleteRule": null
		}`), &mealTemplates); err != nil {
			return err
		}

		if err := app.Save(mealTemplates); err != nil {
			return err
		}

		// Revert meal_history delete rule
		mealHistory, err := app.FindCollectionByNameOrId("meal_history")
		if err != nil {
			return err
		}

		if err := json.Unmarshal([]byte(`{
			"deleteRule": null
		}`), &mealHistory); err != nil {
			return err
		}

		return app.Save(mealHistory)
	})
}