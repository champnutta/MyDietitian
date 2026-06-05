import React from "react";
import { SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>Mydietitian MVP</Text>
        <Text style={styles.title}>AI Nutrition Coach</Text>
        <Text style={styles.body}>
          This app scaffold is ready for the first migration pass from the existing LINE OA + GAS workflow.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Planned first screens</Text>
          <Text style={styles.cardItem}>1. Sign in</Text>
          <Text style={styles.cardItem}>2. Chat and image upload</Text>
          <Text style={styles.cardItem}>3. Analysis result</Text>
          <Text style={styles.cardItem}>4. Meal history</Text>
          <Text style={styles.cardItem}>5. Dashboard</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Migration note</Text>
          <Text style={styles.body}>
            LINE OA can remain active during the transition. The mobile app and LINE webhook should share the same Firebase backend.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f6f4ee"
  },
  container: {
    padding: 24,
    gap: 16
  },
  eyebrow: {
    fontSize: 14,
    fontWeight: "700",
    color: "#7f6a4a",
    textTransform: "uppercase",
    letterSpacing: 1
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    color: "#1f3a2c"
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: "#43534a"
  },
  card: {
    backgroundColor: "#fffdf8",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#e7dcc8"
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1f3a2c",
    marginBottom: 12
  },
  cardItem: {
    fontSize: 15,
    lineHeight: 24,
    color: "#43534a"
  }
});

