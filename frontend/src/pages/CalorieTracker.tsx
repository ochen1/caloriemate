import type React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Camera,
  Target,
  Zap,
  Send,
  User,
  History,
  Calendar,
  Loader2,
  Repeat,
  X,
} from "lucide-react";
import heic2any from "heic2any";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { Badge } from "../components/ui/badge";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { OnboardingModal } from "../components/onboarding-modal";
import { MealReviewModal } from "../components/meal-review-modal";
import { MealHistoryCard } from "../components/meal-history-card";
import { useAuth } from "../contexts/AuthContext";
import ProfilePage from "./ProfilePage";
import WeeklyHistoryPage from "./WeeklyHistoryPage";
import MealLibraryPage from "./MealLibraryPage";
import { UserGoals, OnboardingData } from "../types/common";
import { MealEntry, SimilarMeal } from "../types/meal";
import { Collections, MealTemplatesProcessingStatusOptions } from "../types/pocketbase-types";

import pb from "../lib/pocketbase";

export default function CalorieTracker() {
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [userGoals, setUserGoals] = useState<UserGoals | null>(null);
  const [todayCalories, setTodayCalories] = useState(0);
  const [todayProtein, setTodayProtein] = useState(0);
  const [todayCarbs, setTodayCarbs] = useState(0);
  const [todayFat, setTodayFat] = useState(0);
  const [showMealReview, setShowMealReview] = useState(false);
  const [mealReviewMode, setMealReviewMode] = useState<"review" | "view">(
    "review",
  );
  const [selectedMeal, setSelectedMeal] = useState<MealEntry | null>(null);
  const [mealHistory, setMealHistory] = useState<MealEntry[]>([]);
  const [mealDescription, setMealDescription] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [reanalyzingMealId, setReanalyzingMealId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showWeeklyHistory, setShowWeeklyHistory] = useState(false);
  const [showMealLibrary, setShowMealLibrary] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSubmittingMeal, setIsSubmittingMeal] = useState(false);
  const [lastResetDate, setLastResetDate] = useState<string>(
    new Date().toDateString(),
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isConvertingHeic, setIsConvertingHeic] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualMealName, setManualMealName] = useState("");
  const [manualCalories, setManualCalories] = useState("");
  const [manualProtein, setManualProtein] = useState("");
  const [manualCarbs, setManualCarbs] = useState("");
  const [manualFat, setManualFat] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasLoadedMealsRef = useRef(false);
  const hasLoadedProfileRef = useRef(false);
  const { user } = useAuth();

  // Load user profile from database
  const loadUserProfile = useCallback(async () => {
    try {
      if (!user) return;

      setIsLoadingProfile(true);
      console.log("Loading user profile for user:", user.id);

      const records = await pb.collection("user_profiles").getList(1, 1, {
        filter: `user = "${user.id}"`,
      });

      console.log("User profile query result:", records);

      if (records.items.length > 0) {
        const profile = records.items[0];
        console.log("Found user profile:", profile);
        const goals: UserGoals = {
          target_calories: profile.target_calories || 2000,
          target_protein_g: profile.target_protein_g || 150,
          target_carbs_g: profile.target_carbs_g || 250,
          target_fat_g: profile.target_fat_g || 65,
          weight: profile.weight_kg || 70, // Convert weight_kg to weight
          age: profile.age || 25,
        };
        setUserGoals(goals);
        setIsOnboarded(true);
        console.log("User is onboarded, setting goals:", goals);
      } else {
        // No profile found - user needs onboarding
        console.log("No user profile found - showing onboarding");
        setIsOnboarded(false);
      }
    } catch (error) {
      console.error("Failed to load user profile:", error);
      setIsOnboarded(false);
    } finally {
      setIsLoadingProfile(false);
    }
  }, [user]);

  // Load meal history from PocketBase
  const loadMealHistory = useCallback(async () => {
    try {
      const records = await pb.collection("meal_history").getList(1, 20, {
        sort: "-created",
        expand: "meal",
        filter: pb.filter(
          "adjustments != {:adjustment} && created >= {:today}",
          {
            today: new Date(new Date().setHours(0, 0, 0, 0)).toISOString().replace('T', ' '),
            adjustment: "hidden",
          },
        ),
      });

      const meals: MealEntry[] = records.items.map((record) => {
        const recordData = record as Record<string, unknown>;
        const expandData = recordData.expand as Record<string, unknown>;
        const mealTemplate = expandData?.meal as Record<string, unknown>;
        const portionMultiplier =
          (recordData.portion_multiplier as number) || 1.0;

        return {
          id: record.id,
          mealHistoryId: record.id,
          mealTemplateId: (mealTemplate?.id as string) || "",
          name: (mealTemplate?.name as string) || "Unknown Meal",
          userContext: (mealTemplate?.description as string) || "",
          aiDescription: (mealTemplate?.ai_description as string) || "",
          totalCalories: Math.round(
            ((mealTemplate?.total_calories as number) || 0) *
              portionMultiplier +
              ((recordData.calorie_adjustment as number) || 0),
          ),
          calorieUncertaintyPercent:
            (mealTemplate?.calorie_uncertainty_percent as number) || 0,
          totalProteinG: Math.round(
            ((mealTemplate?.total_protein_g as number) || 0) *
              portionMultiplier +
              ((recordData.protein_adjustment as number) || 0),
          ),
          proteinUncertaintyPercent:
            (mealTemplate?.protein_uncertainty_percent as number) || 0,
          totalCarbsG: Math.round(
            ((mealTemplate?.total_carbs_g as number) || 0) * portionMultiplier +
              ((recordData.carb_adjustment as number) || 0),
          ),
          carbsUncertaintyPercent:
            (mealTemplate?.carbs_uncertainty_percent as number) || 0,
          totalFatG: Math.round(
            ((mealTemplate?.total_fat_g as number) || 0) * portionMultiplier +
              ((recordData.fat_adjustment as number) || 0),
          ),
          fatUncertaintyPercent:
            (mealTemplate?.fat_uncertainty_percent as number) || 0,
          imageUrl: mealTemplate?.image
            ? pb.files.getURL(
                { id: mealTemplate.id as string, collectionId: '', collectionName: 'meal_templates' },
                mealTemplate.image as string,
                { thumb: '100x100' }
              )
            : undefined,
          processingStatus: ((mealTemplate?.processing_status as string) ||
            "pending") as MealTemplatesProcessingStatusOptions,
          created: record.created,
          updated: record.updated,
          linkedMealTemplateId:
            (mealTemplate?.linked_meal_template_id as string) || undefined,
          isPrimaryInGroup:
            (mealTemplate?.is_primary_in_group as boolean) || false,
          portionMultiplier,
          calorieAdjustment: (recordData.calorie_adjustment as number) || 0,
          proteinAdjustment: (recordData.protein_adjustment as number) || 0,
          carbAdjustment: (recordData.carb_adjustment as number) || 0,
          fatAdjustment: (recordData.fat_adjustment as number) || 0,
        };
      });

      const todayMidnightDate = new Date();
      todayMidnightDate.setHours(0, 0, 0, 0);
      const todaysMeals = meals.filter((meal) => {
        const mealDate = new Date(meal.created);
        return mealDate >= todayMidnightDate;
      });

      setMealHistory((prevHistory) => {
        const optimisticEntries = prevHistory.filter((meal) =>
          meal.id.startsWith("temp_"),
        );

        const validOptimisticEntries = optimisticEntries.filter(
          (optimistic) => {
            return (
              !optimistic.mealTemplateId ||
              !todaysMeals.some(
                (real) => real.mealTemplateId === optimistic.mealTemplateId,
              )
            );
          },
        );

        const combinedMeals = [...validOptimisticEntries, ...todaysMeals].sort(
          (a, b) =>
            new Date(b.created).getTime() - new Date(a.created).getTime(),
        );

        const newlyCompletedMeals = todaysMeals.filter((meal) => {
          const wasProcessing = prevHistory.some(
            (prevMeal) =>
              prevMeal.mealTemplateId === meal.mealTemplateId &&
              prevMeal.processingStatus === "processing",
          );
          return meal.processingStatus === "completed" && wasProcessing;
        });

        if (newlyCompletedMeals.length > 0 && !selectedMeal) {
          const mostRecentCompleted = newlyCompletedMeals[0];
          setSelectedMeal(mostRecentCompleted);
          setMealReviewMode("review");
          setShowMealReview(true);
        }

        return combinedMeals;
      });

      const completedTodayMeals = todaysMeals.filter(
        (meal: MealEntry) => meal.processingStatus === "completed",
      );

      const totalCalories = completedTodayMeals.reduce(
        (sum, meal) => sum + meal.totalCalories,
        0,
      );
      const totalProtein = completedTodayMeals.reduce(
        (sum, meal) => sum + meal.totalProteinG,
        0,
      );
      const totalCarbs = completedTodayMeals.reduce(
        (sum, meal) => sum + meal.totalCarbsG,
        0,
      );
      const totalFat = completedTodayMeals.reduce(
        (sum, meal) => sum + meal.totalFatG,
        0,
      );

      setTodayCalories(totalCalories);
      setTodayProtein(totalProtein);
      setTodayCarbs(totalCarbs);
      setTodayFat(totalFat);
    } catch (error) {
      console.error("Failed to load meal history:", error);
    }
  }, []);


  // Poll for processing status updates
  useEffect(() => {
    const processingMeals = mealHistory.filter(
      (meal) => meal.processingStatus === "processing",
    );

    if (processingMeals.length > 0) {
      const interval = setInterval(() => {
        loadMealHistory();
      }, 2000); // Poll every 2 seconds

      return () => clearInterval(interval);
    }
  }, [mealHistory, loadMealHistory]);

  const handleOnboardingComplete = async (data: OnboardingData) => {
    try {
      if (!user) throw new Error("No user found");

      console.log("Completing onboarding with data:", data);

      // Calculate default values using the same logic as onboarding components
      const calculateGoals = () => {
        const age = data.age;
        const weight = data.weight;
        const height = data.height;

        // Simple BMR calculation (Mifflin-St Jeor)
        let bmr: number;
        if (data.gender === "male") {
          bmr = 10 * weight + 6.25 * height - 5 * age + 5;
        } else {
          bmr = 10 * weight + 6.25 * height - 5 * age - 161;
        }

        // Activity multiplier
        const activityMultipliers = {
          sedentary: 1.2,
          light: 1.375,
          moderate: 1.55,
          active: 1.725,
          "very active": 1.9,
        };

        const tdee =
          bmr *
          activityMultipliers[
            data.activityLevel as keyof typeof activityMultipliers
          ];

        // Goal adjustment
        let calories = tdee;
        if (data.goal === "lose_weight") calories -= 500;
        if (data.goal === "gain_weight" || data.goal === "gain_muscle")
          calories += 500;

        // Protein: 1.6-2.2g per kg body weight
        const protein = Math.round(weight * 1.8);

        // Carbs: 40-50% of calories (using 45% as middle ground)
        // 1g carbs = 4 calories
        const carbs = Math.round((calories * 0.45) / 4);

        // Fat: 25-30% of calories (using 27.5% as middle ground)
        // 1g fat = 9 calories
        const fat = Math.round((calories * 0.275) / 9);

        return {
          calories: Math.round(calories),
          protein,
          carbs,
          fat,
        };
      };

      const calculatedGoals = calculateGoals();

      // Create user profile in database
      const profileData = {
        user: user.id,
        target_calories: data.customCalories || calculatedGoals.calories,
        target_protein_g: data.customProtein || calculatedGoals.protein,
        target_carbs_g: data.customCarbs || calculatedGoals.carbs,
        target_fat_g: data.customFat || calculatedGoals.fat,
        weight_kg: data.weight,
        age: data.age,
        height_cm: data.height,
        gender: data.gender,
        activity_level: data.activityLevel,
        goal: data.goal,
      };

      console.log("Creating profile data:", profileData);

      await pb.collection(Collections.UserProfiles).create(profileData);

      console.log("Profile created successfully");

      // Convert to UserGoals format for local state
      const goals: UserGoals = {
        target_calories: data.customCalories || calculatedGoals.calories,
        target_protein_g: data.customProtein || calculatedGoals.protein,
        target_carbs_g: data.customCarbs || calculatedGoals.carbs,
        target_fat_g: data.customFat || calculatedGoals.fat,
        weight: data.weight, // Note: this maps to weight_kg in DB
        age: data.age,
      };

      setUserGoals(goals);
      setIsOnboarded(true);
    } catch (error) {
      console.error("Failed to create user profile:", error);
    }
  };

  const handleCameraCapture = async () => {
    try {
      // For now, fallback to file upload as camera capture would need more complex implementation
      fileInputRef.current?.click();
    } catch (error) {
      console.error("Camera access denied:", error);
      // Fallback to file upload
      fileInputRef.current?.click();
    }
  };

  const convertHeicToJpeg = async (file: File): Promise<File> => {
    try {
      setIsConvertingHeic(true);
      const convertedBlob = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.8,
      });

      // heic2any can return an array or a single blob
      const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;

      // Create a new File with the converted blob
      const convertedFile = new File([blob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });

      return convertedFile;
    } catch (error) {
      console.error('Error converting HEIC file:', error);
      throw error;
    } finally {
      setIsConvertingHeic(false);
    }
  };

  const processImageFile = async (file: File) => {
    let processedFile = file;

    // Check if file is HEIC/HEIF
    if (file.type === 'image/heic' || file.type === 'image/heif' || file.name.toLowerCase().match(/\.(heic|heif)$/)) {
      try {
        processedFile = await convertHeicToJpeg(file);
      } catch (error) {
        console.error('Failed to convert HEIC file, using original:', error);
        // Fall back to original file if conversion fails
        processedFile = file;
      }
    }

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    const newUrl = URL.createObjectURL(processedFile);
    setSelectedImage(processedFile);
    setImagePreviewUrl(newUrl);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await processImageFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if we're leaving the main container
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const imageFile = files.find(file =>
      file.type.startsWith('image/') ||
      file.name.toLowerCase().match(/\.(heic|heif|jpg|jpeg|png|gif|webp)$/i)
    );

    if (imageFile) {
      await processImageFile(imageFile);
    }
  };

  const handleManualMealSubmission = async () => {
    if (isSubmittingMeal) return;

    const calories = parseFloat(manualCalories);
    const protein = parseFloat(manualProtein);
    const carbs = parseFloat(manualCarbs);
    const fat = parseFloat(manualFat);

    if (!manualMealName.trim() || isNaN(calories) || isNaN(protein) || isNaN(carbs) || isNaN(fat)) {
      return;
    }

    setIsSubmittingMeal(true);

    const tempId = `temp_${Date.now()}`;

    try {
      // Create optimistic meal entry that appears immediately
      const optimisticMeal: MealEntry = {
        id: tempId,
        mealHistoryId: tempId,
        mealTemplateId: "",
        name: manualMealName,
        userContext: manualMealName,
        aiDescription: "Manual entry",
        totalCalories: calories,
        calorieUncertaintyPercent: 0,
        totalProteinG: protein,
        proteinUncertaintyPercent: 0,
        totalCarbsG: carbs,
        carbsUncertaintyPercent: 0,
        totalFatG: fat,
        fatUncertaintyPercent: 0,
        imageUrl: undefined,
        processingStatus: MealTemplatesProcessingStatusOptions.completed,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };

      // Add optimistic entry to the beginning of meal history immediately
      setMealHistory((prev) => [optimisticMeal, ...prev]);

      // Create meal template with manual data
      const newMealTemplate = await pb.collection(Collections.MealTemplates).create({
        name: manualMealName,
        description: manualMealName,
        ai_description: "Manual entry",
        total_calories: calories,
        total_protein_g: protein,
        total_carbs_g: carbs,
        total_fat_g: fat,
        calorie_uncertainty_percent: 0,
        protein_uncertainty_percent: 0,
        carbs_uncertainty_percent: 0,
        fat_uncertainty_percent: 0,
        processing_status: "completed",
      });

      // Create meal history entry
      await pb.collection(Collections.MealHistory).create({
        meal: newMealTemplate.id,
        user: pb.authStore.record?.id,
        portion_multiplier: 1.0,
        adjustments: "Manual entry",
      });

      // Update the optimistic entry with the real ID
      setMealHistory((prev) =>
        prev.map((meal) =>
          meal.id === tempId
            ? {
                ...meal,
                id: newMealTemplate.id,
                mealTemplateId: newMealTemplate.id,
              }
            : meal,
        ),
      );

      // Clear form
      setManualMealName("");
      setManualCalories("");
      setManualProtein("");
      setManualCarbs("");
      setManualFat("");
      setShowManualEntry(false);

      // Load fresh meal history to get any updates
      await loadMealHistory();
    } catch (error) {
      console.error("Error creating manual meal:", error);

      // Remove the optimistic entry on error
      setMealHistory((prev) => prev.filter((meal) => meal.id !== tempId));
    } finally {
      setIsSubmittingMeal(false);
    }
  };

  const handleMealSubmission = async () => {
    if (!selectedImage || isSubmittingMeal) return;

    setIsSubmittingMeal(true);

    const tempId = `temp_${Date.now()}`;
    const imageUrl = imagePreviewUrl || "";

    try {
      if (reanalyzingMealId) {
        // RE-ANALYZE: Update existing meal template
        await pb.collection(Collections.MealTemplates).update(reanalyzingMealId, {
          image: selectedImage,
          description: mealDescription || "",
          processing_status: "pending",
        });

        // Update the existing entry in meal history to show processing status
        setMealHistory((prev) =>
          prev.map((meal) =>
            meal.mealTemplateId === reanalyzingMealId
              ? {
                  ...meal,
                  processingStatus: MealTemplatesProcessingStatusOptions.processing,
                  userContext: mealDescription || "",
                }
              : meal,
          ),
        );

        setSelectedImage(null);
        setMealDescription("");
        setReanalyzingMealId(null);
        if (imagePreviewUrl) {
          URL.revokeObjectURL(imagePreviewUrl);
          setImagePreviewUrl(null);
        }

        // Load fresh meal history to get any updates
        await loadMealHistory();
      } else {
        // NEW MEAL: Create optimistic meal entry that appears immediately
        const optimisticMeal: MealEntry = {
          id: tempId,
          mealHistoryId: tempId,
          mealTemplateId: "",
          name: mealDescription || "Analyzing meal...",
          userContext: mealDescription || "",
          aiDescription: "Analysis in progress...",
          totalCalories: 0,
          calorieUncertaintyPercent: 0,
          totalProteinG: 0,
          proteinUncertaintyPercent: 0,
          totalCarbsG: 0,
          carbsUncertaintyPercent: 0,
          totalFatG: 0,
          fatUncertaintyPercent: 0,
          imageUrl: imageUrl,
          processingStatus: MealTemplatesProcessingStatusOptions.processing,
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        };

        // Add optimistic entry to the beginning of meal history immediately
        setMealHistory((prev) => [optimisticMeal, ...prev]);

        const newMealTemplate = await pb.collection(Collections.MealTemplates).create({
          image: selectedImage,
          processing_status: "pending",
          description: mealDescription || "",
        });

        // Update the optimistic entry with the real ID and processing status
        setMealHistory((prev) =>
          prev.map((meal) =>
            meal.id === tempId
              ? {
                  ...meal,
                  id: newMealTemplate.id,
                  mealTemplateId: newMealTemplate.id,
                  processingStatus:
                    MealTemplatesProcessingStatusOptions.processing,
                }
              : meal,
          ),
        );

        setSelectedImage(null);
        setMealDescription("");
        if (imagePreviewUrl) {
          URL.revokeObjectURL(imagePreviewUrl);
          setImagePreviewUrl(null);
        }

        // Load fresh meal history to get any updates
        await loadMealHistory();
      }
    } catch (error) {
      console.error("Error uploading image:", error);

      if (!reanalyzingMealId) {
        // Remove the optimistic entry on error (only for new meals)
        setMealHistory((prev) => prev.filter((meal) => meal.id !== tempId));
      }

      // Clean up on error
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    } finally {
      setIsSubmittingMeal(false);
    }
  };

  const handleMealClick = (meal: MealEntry) => {
    if (meal.processingStatus === "completed") {
      setSelectedMeal(meal);
      setMealReviewMode("view"); // Set to view mode for existing meals
      setShowMealReview(true);
    }
  };

  const handleMealConfirmed = async (confirmedMeal: MealEntry) => {
    try {
      // Get the original template values to calculate adjustments
      if (confirmedMeal.mealTemplateId) {
        const template = await pb.collection('meal_templates').getOne(confirmedMeal.mealTemplateId);
        const portionMultiplier = confirmedMeal.portionMultiplier || 1;

        // Calculate adjustments as deltas from template values
        const calorieAdjustment = confirmedMeal.totalCalories - (template.total_calories * portionMultiplier);
        const proteinAdjustment = confirmedMeal.totalProteinG - (template.total_protein_g * portionMultiplier);
        const carbAdjustment = confirmedMeal.totalCarbsG - (template.total_carbs_g * portionMultiplier);
        const fatAdjustment = confirmedMeal.totalFatG - (template.total_fat_g * portionMultiplier);

        await pb.collection("meal_history").update(confirmedMeal.id, {
          processingStatus: "completed",
          portion_multiplier: portionMultiplier,
          calorie_adjustment: calorieAdjustment,
          protein_adjustment: proteinAdjustment,
          carb_adjustment: carbAdjustment,
          fat_adjustment: fatAdjustment,
        });

        // If name or description changed, update the template
        if (confirmedMeal.name !== template.name || confirmedMeal.aiDescription !== template.ai_description) {
          await pb.collection('meal_templates').update(confirmedMeal.mealTemplateId, {
            name: confirmedMeal.name,
            ai_description: confirmedMeal.aiDescription,
          });
        }
      } else {
        // Fallback if no template ID (shouldn't happen)
        await pb.collection("meal_history").update(confirmedMeal.id, {
          processingStatus: "completed",
        });
      }

      // Refresh meal history
      await loadMealHistory();
    } catch (error) {
      console.error("Error confirming meal:", error);
    }

    setShowMealReview(false);
    setSelectedMeal(null);
  };

  const handleSimilarMealSelected = async (similarMeal: SimilarMeal) => {
    try {
      const newMealRecord = await pb.collection(Collections.MealHistory).create({
        meal: similarMeal.id,
        user: pb.authStore.record?.id,
        portion_multiplier: 1.0,
        adjustments: `Selected from similar meal: ${similarMeal.name}`,
      });

      console.log("Created meal history from similar meal:", newMealRecord);

      await loadMealHistory();
    } catch (error) {
      console.error("Error creating meal from similar meal:", error);
    }

    setShowMealReview(false);
    setSelectedMeal(null);
  };

  const handleMealReanalyze = async (meal: MealEntry) => {
    try {
      if (!meal.mealTemplateId) {
        console.error("Cannot re-analyze meal without template ID");
        return;
      }

      const template = await pb.collection(Collections.MealTemplates).getOne(meal.mealTemplateId);

      if (!template.image) {
        console.error("Cannot re-analyze meal without image");
        return;
      }

      const imageUrl = pb.files.getURL(
        { id: meal.mealTemplateId, collectionId: '', collectionName: 'meal_templates' },
        template.image
      );

      const response = await fetch(imageUrl);
      const blob = await response.blob();

      const file = new File([blob], template.image, { type: blob.type });

      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }

      const newUrl = URL.createObjectURL(file);

      setSelectedImage(file);
      setImagePreviewUrl(newUrl);
      setMealDescription(meal.userContext || template.description || '');
      setReanalyzingMealId(meal.mealTemplateId);

      setShowMealReview(false);
      setSelectedMeal(null);

      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);
    } catch (error) {
      console.error("Error preparing meal for re-analysis:", error);
    }
  };


  // Check for daily reset on mount
  useEffect(() => {
    const currentDate = new Date().toDateString();

    if (currentDate !== lastResetDate) {
      setLastResetDate(currentDate);
      setMealHistory([]);
      setTodayCalories(0);
      setTodayProtein(0);
      setTodayCarbs(0);
      setTodayFat(0);
      hasLoadedMealsRef.current = false;
    }
  }, [lastResetDate]);

  // Set up interval to check for date changes (in case app stays open across midnight)
  useEffect(() => {
    const interval = setInterval(() => {
      const currentDate = new Date().toDateString();
      if (currentDate !== lastResetDate) {
        setTodayCalories(0);
        setTodayProtein(0);
        setTodayCarbs(0);
        setTodayFat(0);
        setMealHistory([]);
        setLastResetDate(currentDate);

        hasLoadedMealsRef.current = false;
        loadMealHistory();
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [lastResetDate, loadMealHistory]);

  // Load user profile and check onboarding status
  useEffect(() => {
    if (user && !hasLoadedProfileRef.current) {
      hasLoadedProfileRef.current = true;
      loadUserProfile();
    }

    // Load meal history from PocketBase when component mounts
    if (!hasLoadedMealsRef.current) {
      hasLoadedMealsRef.current = true;
      loadMealHistory();
    }
  }, [user, loadMealHistory, loadUserProfile]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  if (isLoadingProfile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin mx-auto mb-4 border-4 border-primary border-t-transparent rounded-full" />
          <p className="text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!isOnboarded) {
    return (
      <OnboardingModal open={true} onComplete={handleOnboardingComplete} />
    );
  }

  if (showProfile) {
    return <ProfilePage onBack={() => setShowProfile(false)} />;
  }

  if (showWeeklyHistory) {
    return (
      <WeeklyHistoryPage
        onBack={() => setShowWeeklyHistory(false)}
        userGoals={userGoals}
      />
    );
  }

  if (showMealLibrary) {
    return (
      <MealLibraryPage
        onBack={() => setShowMealLibrary(false)}
        onMealLogged={() => {
          loadMealHistory();
        }}
      />
    );
  }

  const calorieProgress = userGoals
    ? (todayCalories / userGoals.target_calories) * 100
    : 0;
  const proteinProgress = userGoals
    ? (todayProtein / userGoals.target_protein_g) * 100
    : 0;
  const carbsProgress = userGoals
    ? (todayCarbs / userGoals.target_carbs_g) * 100
    : 0;
  const fatProgress = userGoals
    ? (todayFat / userGoals.target_fat_g) * 100
    : 0;
  const isCalorieGoalMet = calorieProgress >= 100;
  const isProteinGoalMet = proteinProgress >= 100;
  const isCarbsGoalMet = carbsProgress >= 100;
  const isFatGoalMet = fatProgress >= 100;

  return (
    <div
      className="min-h-screen bg-background pb-20"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {(isDragging || isConvertingHeic) && (
        <div className="fixed inset-0 bg-primary/10 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-card border-2 border-dashed border-primary rounded-lg p-8 text-center shadow-lg">
            {isConvertingHeic ? (
              <>
                <Loader2 className="h-12 w-12 text-primary mx-auto mb-4 animate-spin" />
                <h3 className="text-lg font-semibold text-foreground mb-2">Converting HEIC image...</h3>
                <p className="text-muted-foreground">Preparing your photo for analysis</p>
              </>
            ) : (
              <>
                <Camera className="h-12 w-12 text-primary mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">Drop your meal photo here</h3>
                <p className="text-muted-foreground">Release to upload and analyze</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-card shadow-sm border-b border-border">
        <div className="max-w-md mx-auto px-4 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                CalorieMate
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Your personal nutrition assistant
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowMealLibrary(true)}
                title="My Meals"
              >
                <History className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowWeeklyHistory(true)}
                title="Weekly History"
              >
                <Calendar className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowProfile(true)}
                title="Profile"
              >
                <User className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-6 space-y-6">
        {/* Daily Progress */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Today's Progress
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Calories */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-foreground">
                  Calories
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">
                    {todayCalories} / {userGoals.target_calories}
                  </span>
                  {isCalorieGoalMet && (
                    <Badge variant="secondary" className="text-xs">
                      Goal Met!
                    </Badge>
                  )}
                </div>
              </div>
              <Progress
                value={Math.min(calorieProgress, 100)}
                className="h-2"
              />
            </div>

            {/* Protein */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-foreground">
                  Protein
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">
                    {todayProtein}g / {userGoals?.target_protein_g}g
                  </span>
                  {isProteinGoalMet && (
                    <Badge variant="secondary" className="text-xs">
                      Goal Met!
                    </Badge>
                  )}
                </div>
              </div>
              <Progress
                value={Math.min(proteinProgress, 100)}
                className="h-2"
              />
            </div>

            {/* Carbs */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-foreground">
                  Carbs
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">
                    {todayCarbs}g / {userGoals?.target_carbs_g}g
                  </span>
                  {isCarbsGoalMet && (
                    <Badge variant="secondary" className="text-xs">
                      Goal Met!
                    </Badge>
                  )}
                </div>
              </div>
              <Progress
                value={Math.min(carbsProgress, 100)}
                className="h-2"
              />
            </div>

            {/* Fat */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-foreground">
                  Fat
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">
                    {todayFat}g / {userGoals?.target_fat_g}g
                  </span>
                  {isFatGoalMet && (
                    <Badge variant="secondary" className="text-xs">
                      Goal Met!
                    </Badge>
                  )}
                </div>
              </div>
              <Progress
                value={Math.min(fatProgress, 100)}
                className="h-2"
              />
            </div>
          </CardContent>
        </Card>

        {/* Weekly Activity */}
        {/* <WeeklyActivity mealHistory={mealHistory} userGoals={userGoals} />*/}

        {/* Add Meal Button */}
        <Card className="overflow-hidden border-2">
          <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 pb-4">
            {reanalyzingMealId && (
              <div className="mb-4 flex items-center gap-2 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 px-3 py-2 rounded-md text-sm border border-blue-200 dark:border-blue-800">
                <Repeat className="h-4 w-4" />
                <span className="font-medium">Re-analyzing meal</span>
                  <button
                   onClick={() => {
                     setReanalyzingMealId(null);
                     setSelectedImage(null);
                     setMealDescription("");
                     if (imagePreviewUrl) {
                       URL.revokeObjectURL(imagePreviewUrl);
                       setImagePreviewUrl(null);
                     }
                   }}
                   className="ml-auto text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100"
                 >
                   <X className="h-4 w-4" />
                 </button>
               </div>
             )}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <Camera className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">
                  {reanalyzingMealId ? "Re-analyze Meal" : "Add New Meal"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {reanalyzingMealId
                    ? "Update details and re-submit for analysis"
                    : "Snap and analyze instantly"}
                </p>
              </div>
            </div>

            {!selectedImage && (
              <Button
                onClick={handleCameraCapture}
                className="w-full shadow-md"
                size="lg"
              >
                <Camera className="h-5 w-5 mr-2" />
                Take a Photo
              </Button>
            )}
          </div>

          <CardContent className="pt-4 space-y-4">
            {/* Show selected image preview */}
            {selectedImage && imagePreviewUrl && (
              <div className="relative">
                <div className="w-full h-40 rounded-lg overflow-hidden bg-muted border-2 border-dashed border-primary/30">
                  <img
                    src={imagePreviewUrl}
                    alt="Selected meal"
                    className="w-full h-full object-cover"
                  />
                </div>
                <button
                  className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm flex items-center justify-center shadow-lg transition-all hover:scale-105 border border-white/20"
                  onClick={() => {
                    setSelectedImage(null);
                    setMealDescription("");
                    setReanalyzingMealId(null);
                    if (imagePreviewUrl) {
                      URL.revokeObjectURL(imagePreviewUrl);
                      setImagePreviewUrl(null);
                    }
                    // Reset file input
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                  title="Remove image and select another"
                >
                  <X className="h-4 w-4 text-white" />
                </button>
              </div>
            )}

            {/* Meal description textarea */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="meal-description" className="text-sm font-medium">
                  Add Details
                </Label>
                <span className="text-xs text-muted-foreground">(Optional)</span>
              </div>
              <Textarea
                id="meal-description"
                placeholder="e.g., Grilled chicken 200g, brown rice, steamed broccoli..."
                value={mealDescription}
                onChange={(e) => setMealDescription(e.target.value)}
                rows={3}
                className="resize-none text-sm"
              />
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
                <span className="text-sm">💡</span>
                <p>Include weight, ingredients, and cooking method for more accurate nutrition estimates</p>
              </div>
            </div>

            {/* Submit button - only show when image is selected */}
            {selectedImage && (
              <Button
                onClick={handleMealSubmission}
                disabled={isSubmittingMeal}
                className="w-full shadow-md"
                size="lg"
              >
                {isSubmittingMeal ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {reanalyzingMealId ? "Re-analyzing..." : "Uploading..."}
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    {reanalyzingMealId ? "Re-analyze Meal" : "Analyze My Meal"}
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Manual Meal Entry */}
        <Card className="border-2">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-950/30 flex items-center justify-center">
                  <span className="text-orange-600 dark:text-orange-400 font-bold text-lg">📝</span>
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Quick Add Meal</h3>
                  <p className="text-xs text-muted-foreground">Enter nutrition info manually</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowManualEntry(!showManualEntry)}
              >
                {showManualEntry ? "Cancel" : "Add Manually"}
              </Button>
            </div>

            {showManualEntry && (
              <div className="space-y-4 mt-4 pt-4 border-t">
                <div className="space-y-2">
                  <Label htmlFor="manual-meal-name" className="text-sm font-medium">
                    Meal Name
                  </Label>
                  <input
                    id="manual-meal-name"
                    type="text"
                    placeholder="e.g., Protein shake, salad, etc."
                    value={manualMealName}
                    onChange={(e) => setManualMealName(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="manual-calories" className="text-sm font-medium">
                      Calories
                    </Label>
                    <input
                      id="manual-calories"
                      type="number"
                      placeholder="0"
                      value={manualCalories}
                      onChange={(e) => setManualCalories(e.target.value)}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      min="0"
                      step="1"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="manual-protein" className="text-sm font-medium">
                      Protein (g)
                    </Label>
                    <input
                      id="manual-protein"
                      type="number"
                      placeholder="0"
                      value={manualProtein}
                      onChange={(e) => setManualProtein(e.target.value)}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      min="0"
                      step="0.1"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="manual-carbs" className="text-sm font-medium">
                      Carbs (g)
                    </Label>
                    <input
                      id="manual-carbs"
                      type="number"
                      placeholder="0"
                      value={manualCarbs}
                      onChange={(e) => setManualCarbs(e.target.value)}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      min="0"
                      step="0.1"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="manual-fat" className="text-sm font-medium">
                      Fat (g)
                    </Label>
                    <input
                      id="manual-fat"
                      type="number"
                      placeholder="0"
                      value={manualFat}
                      onChange={(e) => setManualFat(e.target.value)}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      min="0"
                      step="0.1"
                    />
                  </div>
                </div>

                <Button
                  onClick={handleManualMealSubmission}
                  disabled={isSubmittingMeal || !manualMealName.trim() || !manualCalories || !manualProtein || !manualCarbs || !manualFat}
                  className="w-full shadow-md"
                  size="lg"
                >
                  {isSubmittingMeal ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding Meal...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Add Meal
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Today's Meals */}
        {mealHistory.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Zap className="h-5 w-5 text-accent" />
              Today's Meals
            </h2>
            {mealHistory.map((meal) => (
              <MealHistoryCard
                key={meal.id}
                meal={meal}
                onClick={() => handleMealClick(meal)}
                onMealRemoved={loadMealHistory}
              />
            ))}
          </div>
        )}

      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Meal Review Modal */}
      {selectedMeal && (
        <MealReviewModal
          meal={selectedMeal}
          open={showMealReview}
          mode={mealReviewMode}
          onMealConfirmed={handleMealConfirmed}
          onSimilarMealSelected={handleSimilarMealSelected}
          onMealRemoved={loadMealHistory}
          onMealUpdated={loadMealHistory}
          onReanalyze={handleMealReanalyze}
          onClose={() => {
            setShowMealReview(false);
            setSelectedMeal(null);
          }}
        />
      )}

    </div>
  );
}
